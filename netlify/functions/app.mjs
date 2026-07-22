/**
 * The whole planner, as one Netlify function.
 *
 * Netlify serves files; it does not run a Node server. But server.js is not a
 * thin wrapper around storage — most of it is the arithmetic behind the heatmap,
 * the coverage flags, the priority order and the day's route, and the browser
 * only ever renders what that arithmetic produced. Rewriting eight hundred lines
 * of it in the browser to reach a static site would be a different project.
 *
 * So the server keeps its job and runs per-request instead of continuously.
 * netlify.toml sends every path here, including the static files, because the
 * login gate deliberately covers the application and not just its data — letting
 * the CDN hand out app.js to anyone would quietly undo that.
 *
 * This file is only an adapter. Netlify speaks the web Request/Response API and
 * server.js speaks node:http, so the job is to translate between the two and
 * touch nothing else.
 */

import { Readable } from 'node:stream';
import app from '../../server.js';

const { handleRequest, store } = app;

/** A node:http request, faked well enough for server.js and auth.js. */
function nodeRequest(request, body) {
  // Readable.from gives real 'data'/'end'/'error' events, which is exactly what
  // readBody() in server.js listens for. Hand-rolling an emitter here would be
  // reimplementing a stream badly.
  const req = Readable.from(body ? [body] : []);
  const url = new URL(request.url);

  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = Object.fromEntries(request.headers);
  // auth.js falls back to req.socket.encrypted when x-forwarded-proto is absent.
  // Netlify always sends the header, but an absent socket would throw rather
  // than return false, and a login that 500s is worse than one that is not
  // marked Secure.
  req.socket = {};

  return req;
}

/** A node:http response that collects instead of writing to a socket. */
function nodeResponse(resolve) {
  const headers = new Headers();
  let status = 200;

  const res = {
    setHeader(name, value) {
      // Set-Cookie is the one header that may legitimately repeat.
      if (String(name).toLowerCase() === 'set-cookie') headers.append(name, value);
      else headers.set(name, value);
    },
    writeHead(code, extra = {}) {
      status = code;
      for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
      return res;
    },
    end(payload) {
      resolve(new Response(payload ?? null, { status, headers }));
    },
    // Nothing in server.js streams a response, but a handler that called this
    // and never called end() would hang the function until Netlify killed it.
    write() {
      throw new Error('Chunked responses are not supported by the Netlify adapter.');
    },
  };

  return res;
}

export default async function handler(request) {
  const body = ['GET', 'HEAD'].includes(request.method)
    ? null
    : Buffer.from(await request.arrayBuffer());

  const response = await new Promise((resolve, reject) => {
    const res = nodeResponse(resolve);
    handleRequest(nodeRequest(request, body), res).catch(reject);
  });

  // The container can be frozen the moment this returns, so anything the
  // request queued for writing has to be on its way to Firestore first.
  // RAMA_SERVERLESS drops the debounce to zero, so this is a short wait.
  await store.flush({ timeoutMs: 8000 });

  return response;
}
