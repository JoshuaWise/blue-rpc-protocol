'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const createIncrementor = require('./create-incrementor');
const createHeartbeat = require('./create-heartbeat');
const validate = require('./validate');
const Encoder = require('./encoder');

// TODO: rewrite
// TODO: MethodContext is now call-specific
// TODO: implement method cancellation (also using abortController.signal)
// TODO: note that msgpack decode AND encode can both throw
// TODO: pass abortSignal for destroying streams

// TODO: after encoding a stream to send
//   on data/end/error, send Stream Chunk
//   upon receiving Stream Cancel, destroy the stream
//   DO NOT store this in the set of "open Stream IDs"

// TODO: limit octet stream chunks to be 256 KiB in size, at most
// TODO: maybe buffer/group octet stream chunks to be at least 64 KiB, if waiting anyways
// TODO: when sending a stream, pause/resume based on ws.bufferedAmount (not just Stream Signals)


module.exports = (methods, logger) => {
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

				if (!validate.AnyMessage(msg)) {
					logger('Socket[%s] received invalid Scratch-RPC message', socketId);
					socket.close(1008, 'Invalid message');
					return;
				}

				const config = messageHandlers.get(msg[0]);
				if (!config) {
					logger('Socket[%s] received unknown Scratch-RPC message', socketId);
					// TODO: send a Stream Cancellation for each received Stream
					return;
				}

				if (!config.validate(msg)) {
					logger('Socket[%s] received improper Scratch-RPC message', socketId);
					socket.close(1008, 'Improper message');
					return;
				}

				if (config.noNestedStreams && streams.size) {
					logger('Socket[%s] received forbidden stream nesting', socketId);
					socket.close(1008, 'Stream nesting not allowed');
					return;
				}

				handler(msg, streams);


				// TODO: what to do if we receive duplicate Stream IDs or Request IDs?
				//   this handling is not currently in the spec

				// TODO: after decoding a stream that was received
				//   add to set of "open Stream IDs" (map id to new Stream instance)
				//   upon receiving Stream Chunk, write/end/error the stream
				//   if Stream is destroyed/cancelled, send Stream Cancel
				//   wrap it in an Object Steam, if applicable

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

		const messageHandlers = new Map([
			[0, {
				validate: validate.Request,
				handler: (msg, streams) => {
					// TODO: if method exists then handle
					//   else respond with Error and send Stream Cancellation for each stream
				},
			}],
			[1, {
				validate: validate.Notification,
				handler: (msg, streams) => {
					// TODO: if method exists then handle as notification
					//   else ignore and send Stream Cancellation for each stream
				},
			}],
			[2, {
				validate: () => false,
			}],
			[3, {
				validate: () => false,
			}],
			[4, {
				validate: validate.Cancellation,
				handler: () => {
					// TODO: if recognized then cancel, else ignore
				},
			}],
			[5, {
				validate: validate.StreamChunkData,
				noNestedStreams: true,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[6, {
				validate: validate.StreamChunkEnd,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[7, {
				validate: validate.StreamChunkError,
				noNestedStreams: true,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[8, {
				validate: validate.StreamCancellation,
				handler: () => {
					// TODO: if recognized then cancel, else ignore
				},
			}],
			[9, {
				validate: validate.StreamSignal,
				handler: () => {
					// TODO: if recognized then calculate pause/resume, else ignore
				},
			}],
		]);

		logger('Socket[%s] opened', socketId);
	};
};
