'use strict';
const WebSocket = require('ws');

const socket = Symbol('socket');

// Exposes metadata about a Scratch-RPC method invocation.
// TODO: allow method handlers to check if it's a notification or not
// TODO: expose AbortSignal to check if the request is cancelled or connection closed
module.exports = class MethodContext {
	constructor(_socket) {
		this[socket] = _socket;
	}
};
