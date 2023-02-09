'use strict';
const { Readable } = require('stream');

const onRead = Symbol('onRead'); // TODO: replace Symbol with WeakMaps
const onDestroy = Symbol('onDestroy'); // TODO: replace Symbol with WeakMaps

exports.Class = Readable;
exports.canWriteNull = false; // Node.js streams are weird
exports.isLocked = (stream) => stream.readableFlowing !== null;
exports.isOctetStream = (stream) => stream.readableObjectMode !== true;
exports.dontBubbleError = (stream) => stream.on('error', () => {});

// Used to create a new stream so we can receive it over Scratch-RPC.
exports.new = (isOctetStream) => {
	const stream = new Readable({
		autoDestroy: true,
		objectMode: !isOctetStream,
		read: () => {
			stream[onRead] && stream[onRead]();
		},
		destroy: (err, cb) => {
			stream[onDestroy] && stream[onDestroy]();
			cb(err);
		},
	});
	return stream;
};

// Used to consume a stream, so we can send it over Scratch-RPC.
exports.read = (stream, { onData, onEnd, onError, onClose }) => {
	stream.on('data', onData);
	stream.on('end', onEnd);
	stream.on('error', onError);
	if (stream.closed) {
		Promise.resolve().then(() => onClose(stream.errored));
	} else {
		stream.on('close', () => onClose(stream.errored));
	}

	return {
		pause: () => stream.pause(),
		resume: () => stream.resume(),
		cancel: (...reason) => stream.destroy(...reason),
	};
};

// This should only be used on unlocked streams.
exports.cancel = (stream) => {
	stream.resume(); // Force isLocked to be true
	stream.destroy();
};

// Used only on streams that are being received (i.e., created by Stream.new()).
exports.write = (stream, value) => stream.push(value);
exports.end = (stream) => stream.push(null);
exports.error = (stream, err) => stream.destroy(err);
exports.onResume = (stream, callback) => { stream[onRead] = callback; };
exports.onDestroyed = (stream, callback) => { stream[onDestroy] = callback; };

// Utilities for processing Octet Streams.
exports.stringToOctets = (str) => Buffer.from(str);
exports.concatOctets = (buffers) => Buffer.concat(buffers);

Object.assign(require('../common/stream'), exports);
