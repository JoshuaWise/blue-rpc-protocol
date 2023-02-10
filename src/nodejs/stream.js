'use strict';
const { Readable } = require('stream');

const onRead = Symbol('onRead'); // TODO: replace Symbol with WeakMaps
const onDestroy = Symbol('onDestroy'); // TODO: replace Symbol with WeakMaps

exports.Class = Readable;
exports.canWriteNull = false; // Node.js streams are weird
exports.isLocked = (stream) => stream.readableFlowing !== null;
exports.isOctetStream = (stream) => stream.readableObjectMode !== true;

// Used to create a new stream so we can receive it over BlueRPC.
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

// Used to populate a stream created by Stream.new().
exports.populate = (stream, { onResume, onDestroyed }) => {
	stream[onRead] = onResume;
	stream[onDestroy] = onDestroyed;
	stream.on('error', () => {}); // Suppress Unhandled 'error' events
	return {
		write: (value) => stream.push(value),
		end: () => stream.push(null),
		error: (err) => stream.destroy(err),
	};
};

// Used to consume a stream, so we can send it over BlueRPC.
exports.consume = (stream, { onData, onEnd, onError, onClose }) => {
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

// Utilities for processing Octet Streams.
exports.stringToOctets = (str) => Buffer.from(str);
exports.concatOctets = (buffers) => Buffer.concat(buffers);

Object.assign(require('../common/stream'), exports);
