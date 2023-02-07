'use strict';
const EventEmitter = require('events');
const WebSocket = require('ws');
const createIncrementor = require('./create-incrementor');
const parseRequest = require('./parse-request');
const parseResponse = require('./parse-response');

const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TRIES = 3;
const socket = Symbol('socket');
const pending = Symbol('pending');
const incrementor = Symbol('incrementor');

// A Scratch-RPC client.
// Supported events:
//   error(err)
//   close(close, reason)
//   notification:<METHOD>(...params)
// TODO: remove EventEmitter
//   use a promise for close/error event
//   use something else for notifications
//   in the browser, use Streams API
// TODO: on client.closed:
//   convert to an error for any non-1000, non-1001 code
//   always expose websocket code/reason on Error object, if there is one
// TODO: add AbortSignal support
// TODO: remove EventEmitter
// TODO: send Stream Cancellations for received streams in ignored Responses
// TODO: send Stream Cancellations for received streams in ignored message types
// TODO: limit octet stream chunks to be 256 KiB in size, at most
// TODO: maybe buffer/group octet stream chunks to be at least 64 KiB, if waiting anyways
// TODO: when sending a stream, pause/resume based on ws.bufferedAmount (not just Stream Signals)
module.exports = class ScratchClient extends EventEmitter {
	constructor(sock) {
		// TODO: make sure sock is connected
		super();
		this[socket] = sock;
		this[pending] = new Map();
		this[incrementor] = createIncrementor();

		let hadError = false;
		const emitError = (err) => {
			if (!hadError) {
				hadError = true;
				this.emit('error', err);
			}
		};

		sock.on('error', emitError);

		sock.on('close', (code, reason) => {
			clearTimeout(timer);
			this[pending].clear();
			this.emit('close', code, reason);
		});

		sock.on('ping', () => {
			resetHeartbeat();
			if (sock.readyState === WebSocket.OPEN) {
				sock.pong();
			}
		});

		sock.on('pong', () => {
			resetHeartbeat();
		});

		sock.on('message', (stringOrBuffer) => {
			resetHeartbeat();

			// Parse the incoming response or notification and invoke the appropriate listeners.
			// If the message is invalid, we close the connection.
			let msg = parseResponse(stringOrBuffer) || parseRequest(stringOrBuffer);
			if (msg === null || msg.method && msg.id || !msg.method && !this[pending].has(msg.id)) {
				sock.close(1008); // TODO: add reason message
				emitError(new Error('Invalid message received'));
			} else if (msg.method) {
				this.emit(`notification:${msg.method}`, ...msg.params);
			} else {
				const resolver = this[pending].get(msg.id);
				this[pending].delete(msg.id);
				if (msg.error !== null) {
					resolver.reject(msg.error);
				} else {
					resolver.resolve(msg.result);
				}
			}
		});

		// Send a ping after periods of inactivity, and expect some activity in response.
		const checkHeartbeat = () => {
			if (++heartbeatAttempt > HEARTBEAT_TRIES) {
				// TODO: send 1001
				sock.terminate();
				emitError(new Error('WebSocket heartbeat failure')); // TODO: raise 1006
			} else {
				if (sock.readyState === WebSocket.OPEN) {
					sock.ping();
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
	}

	request(method, ...params) {
		return new Promise((resolve, reject) => {
			if (typeof method !== 'string') {
				throw new TypeError('Expected "method" argument to be a string');
			}
			if (!method) {
				throw new TypeError('Expected "method" argument to be non-empty');
			}
			if (this[socket].readyState === WebSocket.OPEN) {
				const id = String(this[incrementor]());
				this[socket].send(JSON.stringify({ id, method, params }));
				this[pending].set(id, { resolve, reject });
			}
		});
	}

	notify(method, ...params) {
		if (typeof method !== 'string') {
			throw new TypeError('Expected "method" argument to be a string');
		}
		if (!method) {
			throw new TypeError('Expected "method" argument to be non-empty');
		}
		if (this[socket].readyState === WebSocket.OPEN) {
			this[socket].send(JSON.stringify({ id: null, method, params }));
		}
	}

	close(code, reason) {
		this[socket].close(code, reason);
	}

	terminate() {
		this[socket].terminate();
	}

	get readyState() {
		return this[socket].readyState;
	}
};

module.exports.CONNECTING = 0;
module.exports.OPEN = 1;
module.exports.CLOSING = 2;
module.exports.CLOSED = 3;
