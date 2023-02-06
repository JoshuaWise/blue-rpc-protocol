'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const createIncrementor = require('./create-incrementor');
const createHeartbeat = require('./create-heartbeat');
const Encoder = require('./encoder');

// TODO: rewrite
// TODO: implement maxPayload
// TODO: MethodContext is now call-specific
// TODO: implement method cancellation (also using abortController.signal)
// TODO: note that msgpack decode AND encode can both throw
// TODO: pass abortSignal for destroying streams

// TODO: after encoding a stream to send
//   on data/end/error, send Stream Chunk
//   upon receiving Stream Cancel, destroy the stream
//   DO NOT store this in the set of "open Stream IDs"



module.exports = (methods, maxPayload, logger) => {
	const getSocketId = createIncrementor();

	return (socket) => {
		const socketId = getSocketId();
		const abortController = new AbortController();
		const onActivity = createHeartbeat(onHeartbeat, abortController.signal);
		const encoder = new Encoder();

		function onHeartbeat(isAlive) {
			if (isAlive) {
				if (socket.readyState === WebSocket.OPEN) {
					socket.ping();
				}
			} else {
				logger('Socket[%s] heartbeat failure', socketId);
				socket.close(1001, 'Connection timed out');
				socket.terminate();
			}
		}

		// function onInvoke(fn, params, id) {
		// 	new Promise(resolve => resolve(fn.apply(context, params)))
		// 		.then((returned) => {
		// 			logger('Socket[%s] handler succeeded (%s)', socketId, id);
		// 			if (id !== null && socket.readyState === WebSocket.OPEN) {
		// 				const result = typeof returned !== 'object' || !returned ? {} : returned;
		// 				socket.send(JSON.stringify({ id, result, error: null }));
		// 			}
		// 		}, (err) => {
		// 			logger('Socket[%s] handler failed (%s)\n%s', socketId, id, err);
		// 			if (id !== null && socket.readyState === WebSocket.OPEN) {
		// 				const message = err.expose ? err.message || 'Unknown server error' : 'Unknown server error';
		// 				const error = { code: -32000, message };
		// 				socket.send(JSON.stringify({ id, result: null, error }));
		// 			}
		// 		});
		// }

		socket
			.on('error', (err) => {
				logger('Socket[%s] error: %s', socketId, err);
			})
			.on('close', () => {
				logger('Socket[%s] closed', socketId);
				abortController.abort();
			})
			.on('ping', () => {
				onActivity();
			})
			.on('pong', () => {
				onActivity();
			})
			.on('message', (rawMsg) => {
				onActivity();

				if (typeof rawMsg === 'string') {
					logger('Socket[%s] received forbidden text frame', socketId);
					socket.close(1003, 'Text frames not allowed');
					return;
				}

				let msg, streams;
				try {
					const result = encoder.decode(rawMsg);
					msg = result.result;
					streams = result.streams;
				} catch (err) {
					logger('Socket[%s] received invalid MessagePack\n%s', socketId, err);
					socket.close(1008, err.msgpackExtensionType ? err.message : 'Invalid MessagePack');
					return;
				}

				// TODO: what to do if a stream is received in an ignored...
				//   Response? (due to earlier cancellation): must send Stream Cancellations
				//   unrecognized message type? (due to some future spec version)


				// message is not an array, or first element not an integer: 1008
				// unrecognized message type:
				//   if (10 or negative) then 1008
				//   else ignore, and send a Stream Cancellation for each received Stream
				// message wrong length or wrong typed elements: 1008

				// violated maxPayload: 1009
				//   calculate from rawMsg buffer sizes of:
				//     Request (0, 1)
				//     Response (2, 3)
				//     Stream Chunk (5, 6, 7)

				// TODO: what to do if we receive duplicate Stream IDs or Request IDs?
				//   this handling is not currently in the spec

				// TODO: after decoding a stream that was received
				//   add to set of "open Stream IDs" (map id to new Stream instance)
				//   upon receiving Stream Chunk, write/end/error the stream
				//   if Stream is destroyed/cancelled, send Stream Cancel
				//   wrap it in an Object Steam, if applicable





				// received Request:
				//   handle as normal or as notification
				//   if method not defined then respond with Error
				// received Response: 1008
				// received Cancellation: if recognized then cancel, else ignore

				// received Stream Chunk:
				//   if recognized then handle, else ignore
				//   if has Stream Data which contains any (possibly nested) Stream, then 1008
				//   if has Error which contains any (possibly nested) Stream, then 1008
				// received Stream Cancellation: if recognized then cancel, else ignore
				// received Stream Signal: if recognized then calculate pause/resume, else ignore

				// TODO: for buffering purposes, all Streams are internally binary streams
				//   but Object Streams are eventually exposed to the user as object streams.



				// Parse the incoming request and invoke the appropriate method, if one exists.
				// If the request is invalid, we terminate the connection.
				const msg = parseRequest(stringOrBuffer);
				if (msg === null || !methods.has(msg.method)) {
					logger('Socket[%s] invalid request received', socketId);
					socket.terminate(); // TODO: needs status code and reason
				} else {
					logger('Socket[%s] request received: "%s" (%s)', socketId, msg.method, msg.id);
					onInvoke(methods.get(msg.method), msg.params, msg.id);
				}
			});

		logger('Socket[%s] opened', socketId);
	};
};
