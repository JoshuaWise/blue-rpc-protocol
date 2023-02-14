'use strict';
const Stream = require('./stream');

// The chunk size should be no less than the smallest block size of all
// filesystems involved in the pipeline (including both source and destination).
// Most modern filesystems use a 4 KiB block size, but there's no harm in going
// a bit larger to account for future evolutions in hardware. We use 64 KiB to
// match the default highWaterMark of streams created by fs.createReadStream().
// The BlueRPC specification enforces a maximum chunk size of 256 KiB.
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
		this._isOctets = Stream.isOctetStream(stream);
		this._chunks = [];
		this._chunksSize = 0;
		this._credit = 0;
		this._backpressure = false;
		this._destroyed = false;

		// TODO: we shouldn't just pause, we should also avoid sending data that
		// would exceeed the available credit, but that means we would need to
		// actually buffer data (not just chunks) and delay calling onEnd().
		const shouldPause = () => {
			return getBufferedAmount() >= HIGH_WATER_MARK
				|| this._backpressure && this._credit <= 0;
		};

		const send = (data) => {
			onData(data, this._checkPressure);
			this._credit -= data.byteLength;
			if (shouldPause()) this._streamControls.pause();
		};

		const flushChunks = (requiredChunkSize) => {
			while (
				this._chunksSize >= requiredChunkSize
				|| this._chunksSize && getBufferedAmount() < IDEAL_CHUNK_SIZE
			) {
				const data = this._chunks.length > 1
					? Stream.concatOctets(this._chunks)
					: this._chunks[0];
				const toSend = data.subarray(0, IDEAL_CHUNK_SIZE);
				const toKeep = data.subarray(IDEAL_CHUNK_SIZE);
				this._chunks = toKeep.byteLength ? [toKeep] : [];
				this._chunksSize = toKeep.byteLength;
				send(toSend);
			}
		};

		this._checkPressure = () => {
			if (!this._destroyed && !shouldPause()) {
				this._streamControls.resume();
				if (this._chunksSize) {
					flushChunks(IDEAL_CHUNK_SIZE);
				}
			}
		};

		this._streamControls = Stream.consume(stream, {
			onData: (data) => {
				if (this._isOctets) {
					if (typeof data === 'string') {
						data = Stream.stringToOctets(data);
					}
					this._chunks.push(data);
					this._chunksSize += data.byteLength;
					flushChunks(IDEAL_CHUNK_SIZE);
				} else {
					try {
						data = encoder.encodeInert(data);
					} catch (err) {
						// TODO: raise error
						return;
					}
					send(data);
				}
			},
			onEnd: () => {
				flushChunks(1);
				onEnd();
			},
			onError: (err) => {
				this._destroyed = true;
				this._chunks = [];
				this._chunksSize = 0;
				this._streamControls.cancel(err);
				onError(err);
			},
			onClose: (err) => {
				this._destroyed = true;
				this._chunks = [];
				this._chunksSize = 0;
				this._checkPressure = () => {};
				this._streamControls.cancel = () => {};
				this._streamControls.pause = () => {};
				this._streamControls.resume = () => {};
				onError(err || new Error('Stream was closed prematurely'));
				onData = () => {};
				onEnd = () => {};
				onError = () => {};
				getBufferedAmount = () => 0;
			},
		});
	}

	cancel(...reason) {
		this._streamControls.cancel(...reason);
	}

	signal(credit) {
		if (credit === null) {
			this._backpressure = false;
			this._checkPressure();
		} else {
			this._backpressure = true;
			this._credit += credit;
			if (this._credit <= 0) {
				this._streamControls.pause();
			} else {
				this._checkPressure();
			}
		}
	}
};
