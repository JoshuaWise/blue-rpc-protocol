'use strict';
const { Readable } = require('stream');
const exports = require('.');

const onRead = Symbol('onRead');
const onDestroy = Symbol('onDestroy');

exports.Class = Readable;
exports.isLocked = (stream) => stream.readableFlowing !== null;
exports.isOctetStream = (stream) => stream.readableObjectMode !== true;
exports.write = (stream, value) => stream.push(value);
exports.end = (stream) => stream.push(null);
exports.error = (stream, err) => stream.destroy(err);
exports.cancel = (stream) => stream.destroy();
exports.canWriteNull = false;

// TODO: allow configurable highWaterMark (based on Peer's settings)
// TODO: pass the connection's AbortSignal as "signal" option
//   or, just use require('stream').addAbortSignal(signal, stream)
exports.new = (isOctetStream) => {
	return new Readable({
		objectMode: !isOctetStream,
		read: () => stream[onRead] && stream[onRead](),
		destroy: () => stream[onDestroy] && stream[onDestroy](),
	});
};

exports.onResume = (stream, callback) => {
	stream[onRead] = callback;
};

exports.onCancelled = (stream, callback) => {
	stream[onDestroy] = callback;
};
