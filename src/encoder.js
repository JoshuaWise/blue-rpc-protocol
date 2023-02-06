'use strict';
const msgpack = require('tiny-msgpack');
const createIncrementor = require('./create-incrementor');
const Stream = require('./stream');

/*
	The Encoder is used to encode and decode MessagePack data, while supporting
	the extension types defined by Scratch-RPC (Stream and Error). Encoded
	streams are automatically assigned an incremented ID. Also, it returns info
	to callers about the streams that were encoded or decoded.
 */

module.exports = class Encoder {
	constructor() {
		const getStreamId = createIncrementor();
		this._streamsById = new Map();
		this._encodingCache = new Map();
		this._codecWithStreams = new msgpack.Codec();
		this._codecWithoutStreams = new msgpack.Codec();

		const encodeError = (err, codec) => {
			return msgpack.encode(Object.assign({ message: err.message }, err), codec);
		};

		const decodeError = (buffer, codec) => {
			const format = buffer[0];
			if ((format & 0xf0) !== 0x80 && format !== 0xde && format !== 0xdf) {
				throw new Error('Invalid Error type received (not a Map)');
			}
			const obj = msgpack.decode(buffer, codec);
			if (obj.message === undefined) {
				throw new Error('Invalid Error type received (no "message" key)');
			}
			if (typeof obj.message !== 'string') {
				throw new Error('Invalid Error type received (non-string "message")');
			}
			return Object.assign(new Error(obj.message), obj);
		};

		const encodeStream = (stream) => {
			if (Stream.isLocked(stream)) {
				throw new TypeError('Illegal attempt to send a stream that already has a reader');
			}
			let buffer = this._encodingCache.get(stream);
			if (buffer === undefined) {
				buffer = new Uint8Array(8);
				const streamId = getStreamId();
				const isOctetStream = Stream.isOctetStream(stream);
				buffer[0] = streamId >>> 24;
				buffer[1] = streamId >>> 16;
				buffer[2] = streamId >>> 8;
				buffer[3] = streamId;
				buffer[4] = isOctetStream ? 1 : 0;
				this._encodingCache.set(stream, buffer);
				this._streamsById.set(streamId, { stream, isOctetStream });
			}
			return buffer;
		};

		const decodeStream = (buffer) => {
			if (buffer.byteLength !== 8) {
				throw new Error('Invalid Stream type received (not in "fixext 8" format)');
			}
			const streamId
				= (buffer[0] << 24)
				| (buffer[1] << 16)
				| (buffer[2] << 8)
				| buffer[3];
			let entry = this._streamsById.get(streamId);
			if (entry === undefined) {
				const stream = Stream.new(true);
				const isOctetStream = buffer[4] & 1 ? true : false;
				this._streamsById.set(streamId, entry = { stream, isOctetStream });
			}
			return entry.stream;
		};

		this._codecWithStreams.register(0, Stream.Class, encodeStream, decodeStream);
		this._codecWithStreams.register(1, Error, encodeError, decodeError);
		this._codecWithoutStreams.register(1, Error, encodeError, decodeError);
	}

	// Encode a MessagePack value, ensuring that no streams are encoded.
	encodeWithoutStreams(value) {
		return msgpack.encode(value, this._codecWithoutStreams);
	}

	// Encode a MessagePack value, and also return info about encoded streams.
	encode(value) {
		try {
			const result = msgpack.encode(value, this._codecWithStreams);
			const streams = this._streamsById;
			return { result, streams };
		} finally {
			this._streamsById = new Map();
			this._encodingCache = new Map();
		}
	}

	// Decode a MessagePack value, and also return info about decoded streams.
	decode(buffer) {
		try {
			const result = msgpack.decode(buffer, this._codecWithStreams);
			const streams = this._streamsById;
			return { result, streams };
		} finally {
			this._streamsById = new Map();
		}
	}
};
