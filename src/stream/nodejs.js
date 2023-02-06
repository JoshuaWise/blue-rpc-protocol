'use strict';
const { Readable } = require('stream');
const exports = require('.');

exports.Class = Readable;
exports.isLocked = (stream) => stream.readableFlowing !== null;
exports.isOctetStream = (stream) => stream.readableObjectMode !== true;

// TODO: allow configurable highWaterMark (based on Peer's settings)
// TODO: pass the connection's AbortSignal as "signal" option
//   or, just use require('stream').addAbortSignal(signal, stream)
exports.new = (isOctetStream) => {
	return new Readable({ objectMode: !isOctetStream });
};
