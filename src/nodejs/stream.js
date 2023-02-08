'use strict';
const { Readable } = require('stream');

const onRead = Symbol('onRead');
const onDestroy = Symbol('onDestroy');

exports.Class = Readable;
exports.isLocked = (stream) => stream.readableFlowing !== null;
exports.isClosed = (stream) => stream.closed === true;
exports.isOctetStream = (stream) => stream.readableObjectMode !== true;
exports.getError = (stream) => stream.errored;
exports.write = (stream, value) => stream.push(value);
exports.end = (stream) => stream.push(null);
exports.error = (stream, err) => stream.destroy(err);
exports.cancel = (stream) => stream.destroy();
exports.pause = (stream) => stream.pause();
exports.resume = (stream) => stream.resume();
exports.stringToOctets = (str) => Buffer.from(str);
exports.concatOctets = (buffers) => Buffer.concat(buffers);
exports.canWriteNull = false; // Node.js streams are weird

exports.new = (isOctetStream) => {
	const stream = new Readable({
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

// Only for streams created by Stream.new()
exports.onResume = (stream, callback) => {
	stream[onRead] = callback;
};

// Only for streams created by Stream.new()
exports.onDestroyed = (stream, callback) => {
	stream[onDestroy] = callback;
};

exports.onData = (stream, callback) => {
	stream.on('data', callback);
};

exports.onEnd = (stream, callback) => {
	stream.on('end', callback);
};

exports.onError = (stream, callback) => {
	stream.on('error', callback);
};

exports.onClose = (stream, callback) => {
	stream.on('close', callback);
};

Object.assign(require('../common/stream'), exports);
