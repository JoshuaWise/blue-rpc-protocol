'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const createIncrementor = require('./create-incrementor');
const parseRequest = require('./parse-request');

const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TRIES = 3;
const getSocketId = createIncrementor();

// TODO: rewrite
// TODO: implement use of logger
// TODO: implement maxPayload
// TODO: use createHeartbeat
// TODO: MethodContext is now call-specific
// TODO: use msgpack
// TODO: implement method cancellation

module.exports = (methods) => (socket) => {
	const context = new MethodContext(socket);
	const socketId = getSocketId();
	console.log('Socket[%s] opened', socketId);

	socket.on('error', (err) => {
		console.log('Socket[%s] error: %s', socketId, err);
	});

	socket.on('close', () => {
		clearTimeout(timer);
		console.log('Socket[%s] closed', socketId);
	});

	socket.on('ping', () => {
		resetHeartbeat();
		if (socket.readyState === WebSocket.OPEN) {
			socket.pong();
		}
	});

	socket.on('pong', () => {
		resetHeartbeat();
	});

	socket.on('message', (stringOrBuffer) => {
		resetHeartbeat();

		// Parse the incoming request and invoke the appropriate method, if one exists.
		// If the request is invalid, we terminate the connection.
		const msg = parseRequest(stringOrBuffer);
		if (msg === null || !methods.has(msg.method)) {
			console.log('Socket[%s] invalid request received', socketId);
			socket.terminate();
		} else {
			console.log('Socket[%s] request received: "%s" (%s)', socketId, msg.method, msg.id);
			invoke(methods.get(msg.method), msg.params, msg.id);
		}
	});

	// Invoke a method and reply with a Scratch-RPC response, if appropriate.
	const invoke = (fn, params, id) => {
		new Promise(resolve => resolve(fn.apply(context, params)))
			.then((returned) => {
				console.log('Socket[%s] handler succeeded (%s)', socketId, id);
				if (id !== null && socket.readyState === WebSocket.OPEN) {
					const result = typeof returned !== 'object' || !returned ? {} : returned;
					socket.send(JSON.stringify({ id, result, error: null }));
				}
			}, (err) => {
				console.log('Socket[%s] handler failed (%s)\n%s', socketId, id, err);
				if (id !== null && socket.readyState === WebSocket.OPEN) {
					const message = err.expose ? err.message || 'Unknown server error' : 'Unknown server error';
					const error = { code: -32000, message };
					socket.send(JSON.stringify({ id, result: null, error }));
				}
			});
	};

	// Send a ping after periods of inactivity, and expect some activity in response.
	const checkHeartbeat = () => {
		if (++heartbeatAttempt > HEARTBEAT_TRIES) {
			console.log('Socket[%s] heartbeat failure', socketId);
			socket.terminate();
		} else {
			if (socket.readyState === WebSocket.OPEN) {
				socket.ping();
			}
			timer = setTimeout(checkHeartbeat, HEARTBEAT_INTERVAL);
		}
	};

	// After receiving any activity, reset the heartbeat timer and counter.
	const resetHeartbeat = () => {
		heartbeatAttempt = 0;
		clearTimeout(timer);
		timer = setTimeout(checkHeartbeat, HEARTBEAT_INTERVAL);
	};

	let heartbeatAttempt = 0;
	let timer = setTimeout(checkHeartbeat, HEARTBEAT_INTERVAL);
};
