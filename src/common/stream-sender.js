'use strict';
const Stream = require('./stream');

// For performance reasons, the chunk size should be no less than the smallest
// block size of all filesystems involved in the pipeline (including both source
// and destination). Most modern filesystems use a 4 KiB block size, but there's
// no harm in going a bit larger to account for future evolutions in hardware.
// We use 64 KiB to match the default highWaterMark of streams created by
// fs.createReadStream(). Enforcing a chunk size also ensures that Stream Chunk
// messages are never larger than 256 KiB, per the BlueRPC specification.
const IDEAL_CHUNK_SIZE = 1024 * 64;

// The HIGH_WATER_MARK determines how much outgoing data we'll buffer before
// pausing the source stream. It limits our memory usage when the source stream
// can provide data much faster than we can send it. However, if it's too small,
// we can end up sending all the buffered data before the source is able to
// provide more, resulting in wasted time.
// A HIGH_WATER_MARK of 0.5 MiB should be good enough for sending data at 2 Gbps
// from a source that has a latency of 2ms. Fast SSDs, which typically have a
// latency of 0.5ms or lower, could use a smaller HIGH_WATER_MARK to save some
// memory. Slow HDDs (especially below 7,200 RPM) might benefit from a greater
// HIGH_WATER_MARK, but are likely to be bottlenecked by throughput instead.
const HIGH_WATER_MARK = 1024 * 512;

module.exports = class StreamSender {
	constructor(stream, encoder, { onData, onEnd, onError, getBufferedAmount }) {
		this._stream = stream;
		this._encoder = encoder;
		this._isOctets = Stream.isOctetStream(stream);
		this._chunks = [];
		this._chunksSize = 0;
		this._credit = 0;
		this._ignoringCredit = false;
		this._ended = false;
		this._destroyed = false;
		this._onData = onData;
		this._onEnd = onEnd;
		this._onError = onError;
		this._getBufferedAmount = getBufferedAmount;

		this._streamControls = Stream.consume(stream, {
			onData: (data) => {
				if (this._isOctets) {
					if (typeof data === 'string') {
						data = Stream.stringToOctets(data);
					}
					this._chunks.push(data);
					this._chunksSize += data.byteLength;
					this._flushChunks();
				} else {
					try {
						data = this._encoder.encodeInert(data);
					} catch (err) {
						this.cancel(err);
						return;
					}
					this._send(data);
				}
			},
			onEnd: () => {
				this._ended = true;
				if (!this._shouldPause()) {
					this._flushChunks();
				}
				if (!this._chunksSize) {
					this._onEnd();
					this._cleanup();
				}
			},
			onError: (err) => {
				this._destroyed = true;
				this._chunks = [];
				this._chunksSize = 0;
				this._streamControls.cancel(err);
				this._onError(err);
			},
			onClose: (err) => {
				if (!this._ended) {
					this._onError(err || new Error('Stream was closed prematurely'));
					this._cleanup();
				}
			},
		});

		this._streamControls.pause();
		this._maybeResume = this._maybeResume.bind(this);
	}

	// Sends data. Returns true if more data can be sent, otherwise false.
	_send(data) {
		this._onData(data, this._maybeResume);
		this._credit -= data.byteLength;
		if (this._shouldPause()) {
			this._streamControls.pause();
			return false;
		}
		return true;
	}

	// Repeatedly sends chunks as long as there's enough data for them to be
	// ideally sized. Only sends smaller chunks if the output buffer is low
	// or if the stream has ended.
	_flushChunks() {
		while (
			this._chunksSize >= IDEAL_CHUNK_SIZE
			|| this._chunksSize && (
				this._getBufferedAmount() < IDEAL_CHUNK_SIZE || this._ended
			)
		) {
			const data = this._chunks.length > 1
				? Stream.concatOctets(this._chunks)
				: this._chunks[0];
			const toSend = data.subarray(0, IDEAL_CHUNK_SIZE);
			const toKeep = data.subarray(IDEAL_CHUNK_SIZE);
			this._chunks = toKeep.byteLength ? [toKeep] : [];
			this._chunksSize = toKeep.byteLength;
			if (!this._send(toSend)) break;
		}
	}

	// We might pause either from the output buffer being full, or because
	// we haven't received enough credits from the other peer.
	_shouldPause() {
		return this._getBufferedAmount() >= HIGH_WATER_MARK
			|| !this._ignoringCredit && this._credit <= 0;
	}

	// Resumes sending data if we are allowed to do so.
	_maybeResume() {
		if (!this._destroyed && !this._shouldPause()) {
			this._streamControls.resume();
			this._flushChunks();
			if (this._ended && !this._chunksSize) {
				this._onEnd();
				this._cleanup();
			}
		}
	}

	_cleanup() {
		this._destroyed = true;
		this._chunks = [];
		this._chunksSize = 0;
		this._onData = () => {};
		this._onEnd = () => {};
		this._onError = () => {};
		this._getBufferedAmount = () => 0;
		this._streamControls.cancel = () => {};
		this._streamControls.pause = () => {};
		this._streamControls.resume = () => {};
	}

	cancel(...reason) {
		this._streamControls.cancel(...reason);
		if (!this._destroyed && this._ended) {
			this._onError(reason[0] || new Error('Stream was closed prematurely'));
			this._cleanup();
		}
	}

	signal(credit) {
		if (credit === null) {
			this._ignoringCredit = true;
			this._maybeResume();
		} else {
			this._ignoringCredit = false;
			this._credit += credit;
			if (this._credit <= 0) {
				this._streamControls.pause();
			} else {
				this._maybeResume();
			}
		}
	}
};
