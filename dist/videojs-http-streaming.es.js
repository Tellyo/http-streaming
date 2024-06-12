/*! @name @videojs/http-streaming @version 3.12.2 @license Apache-2.0 */
import _inheritsLoose from '@babel/runtime/helpers/inheritsLoose';
import document from 'global/document';
import window$1 from 'global/window';
import _extends from '@babel/runtime/helpers/extends';
import _assertThisInitialized from '@babel/runtime/helpers/assertThisInitialized';
import _resolveUrl from '@videojs/vhs-utils/es/resolve-url.js';
import videojs from 'video.js';
import { Parser } from 'm3u8-parser';
import { isAudioCodec, translateLegacyCodec, codecsFromDefault, parseCodecs, getMimeForCodec, DEFAULT_VIDEO_CODEC, DEFAULT_AUDIO_CODEC, browserSupportsCodec, muxerSupportsCodec } from '@videojs/vhs-utils/es/codecs.js';
import { simpleTypeFromSourceType } from '@videojs/vhs-utils/es/media-types.js';
export { simpleTypeFromSourceType } from '@videojs/vhs-utils/es/media-types.js';
import { isArrayBufferView, concatTypedArrays, stringToBytes, toUint8 } from '@videojs/vhs-utils/es/byte-helpers';
import { generateSidxKey, parseUTCTiming, parse, addSidxSegmentsToPlaylist } from 'mpd-parser';
import parseSidx from 'mux.js/lib/tools/parse-sidx';
import { getId3Offset } from '@videojs/vhs-utils/es/id3-helpers';
import { detectContainerForBytes, isLikelyFmp4MediaSegment } from '@videojs/vhs-utils/es/containers';
import _createClass from '@babel/runtime/helpers/createClass';
import { ONE_SECOND_IN_TS } from 'mux.js/lib/utils/clock';
import _wrapNativeSuper from '@babel/runtime/helpers/wrapNativeSuper';

/**
 * @file resolve-url.js - Handling how URLs are resolved and manipulated
 */
var resolveUrl = _resolveUrl;
/**
 * If the xhr request was redirected, return the responseURL, otherwise,
 * return the original url.
 *
 * @api private
 *
 * @param  {string} url - an url being requested
 * @param  {XMLHttpRequest} req - xhr request result
 *
 * @return {string}
 */

var resolveManifestRedirect = function resolveManifestRedirect(url, req) {
  // To understand how the responseURL below is set and generated:
  // - https://fetch.spec.whatwg.org/#concept-response-url
  // - https://fetch.spec.whatwg.org/#atomic-http-redirect-handling
  if (req && req.responseURL && url !== req.responseURL) {
    return req.responseURL;
  }

  return url;
};

var logger = function logger(source) {
  if (videojs.log.debug) {
    return videojs.log.debug.bind(videojs, 'VHS:', source + " >");
  }

  return function () {};
};

/**
 * Provides a compatibility layer between Video.js 7 and 8 API changes for VHS.
 */
/**
 * Delegates to videojs.obj.merge (Video.js 8) or
 * videojs.mergeOptions (Video.js 7).
 */

function merge() {
  var context = videojs.obj || videojs;
  var fn = context.merge || context.mergeOptions;

  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  return fn.apply(context, args);
}
/**
 * Delegates to videojs.time.createTimeRanges (Video.js 8) or
 * videojs.createTimeRanges (Video.js 7).
 */

function createTimeRanges() {
  var context = videojs.time || videojs;
  var fn = context.createTimeRanges || context.createTimeRanges;

  for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
    args[_key2] = arguments[_key2];
  }

  return fn.apply(context, args);
}
/**
 * Converts provided buffered ranges to a descriptive string
 *
 * @param {TimeRanges} buffered - received buffered time ranges
 *
 * @return {string} - descriptive string
 */

function bufferedRangesToString(buffered) {
  if (buffered.length === 0) {
    return 'Buffered Ranges are empty';
  }

  var bufferedRangesStr = 'Buffered Ranges: \n';

  for (var i = 0; i < buffered.length; i++) {
    var start = buffered.start(i);
    var end = buffered.end(i);
    bufferedRangesStr += start + " --> " + end + ". Duration (" + (end - start) + ")\n";
  }

  return bufferedRangesStr;
}

/**
 * ranges
 *
 * Utilities for working with TimeRanges.
 *
 */

var TIME_FUDGE_FACTOR = 1 / 30; // Comparisons between time values such as current time and the end of the buffered range
// can be misleading because of precision differences or when the current media has poorly
// aligned audio and video, which can cause values to be slightly off from what you would
// expect. This value is what we consider to be safe to use in such comparisons to account
// for these scenarios.

var SAFE_TIME_DELTA = TIME_FUDGE_FACTOR * 3;

var filterRanges = function filterRanges(timeRanges, predicate) {
  var results = [];
  var i;

  if (timeRanges && timeRanges.length) {
    // Search for ranges that match the predicate
    for (i = 0; i < timeRanges.length; i++) {
      if (predicate(timeRanges.start(i), timeRanges.end(i))) {
        results.push([timeRanges.start(i), timeRanges.end(i)]);
      }
    }
  }

  return createTimeRanges(results);
};
/**
 * Attempts to find the buffered TimeRange that contains the specified
 * time.
 *
 * @param {TimeRanges} buffered - the TimeRanges object to query
 * @param {number} time  - the time to filter on.
 * @return {TimeRanges} a new TimeRanges object
 */


var findRange = function findRange(buffered, time) {
  return filterRanges(buffered, function (start, end) {
    return start - SAFE_TIME_DELTA <= time && end + SAFE_TIME_DELTA >= time;
  });
};
/**
 * Returns the TimeRanges that begin later than the specified time.
 *
 * @param {TimeRanges} timeRanges - the TimeRanges object to query
 * @param {number} time - the time to filter on.
 * @return {TimeRanges} a new TimeRanges object.
 */

var findNextRange = function findNextRange(timeRanges, time) {
  return filterRanges(timeRanges, function (start) {
    return start - TIME_FUDGE_FACTOR >= time;
  });
};
/**
 * Returns gaps within a list of TimeRanges
 *
 * @param {TimeRanges} buffered - the TimeRanges object
 * @return {TimeRanges} a TimeRanges object of gaps
 */

var findGaps = function findGaps(buffered) {
  if (buffered.length < 2) {
    return createTimeRanges();
  }

  var ranges = [];

  for (var i = 1; i < buffered.length; i++) {
    var start = buffered.end(i - 1);
    var end = buffered.start(i);
    ranges.push([start, end]);
  }

  return createTimeRanges(ranges);
};
/**
 * Calculate the intersection of two TimeRanges
 *
 * @param {TimeRanges} bufferA
 * @param {TimeRanges} bufferB
 * @return {TimeRanges} The interesection of `bufferA` with `bufferB`
 */

var bufferIntersection = function bufferIntersection(bufferA, bufferB) {
  var start = null;
  var end = null;
  var arity = 0;
  var extents = [];
  var ranges = [];

  if (!bufferA || !bufferA.length || !bufferB || !bufferB.length) {
    return createTimeRanges();
  } // Handle the case where we have both buffers and create an
  // intersection of the two


  var count = bufferA.length; // A) Gather up all start and end times

  while (count--) {
    extents.push({
      time: bufferA.start(count),
      type: 'start'
    });
    extents.push({
      time: bufferA.end(count),
      type: 'end'
    });
  }

  count = bufferB.length;

  while (count--) {
    extents.push({
      time: bufferB.start(count),
      type: 'start'
    });
    extents.push({
      time: bufferB.end(count),
      type: 'end'
    });
  } // B) Sort them by time


  extents.sort(function (a, b) {
    return a.time - b.time;
  }); // C) Go along one by one incrementing arity for start and decrementing
  //    arity for ends

  for (count = 0; count < extents.length; count++) {
    if (extents[count].type === 'start') {
      arity++; // D) If arity is ever incremented to 2 we are entering an
      //    overlapping range

      if (arity === 2) {
        start = extents[count].time;
      }
    } else if (extents[count].type === 'end') {
      arity--; // E) If arity is ever decremented to 1 we leaving an
      //    overlapping range

      if (arity === 1) {
        end = extents[count].time;
      }
    } // F) Record overlapping ranges


    if (start !== null && end !== null) {
      ranges.push([start, end]);
      start = null;
      end = null;
    }
  }

  return createTimeRanges(ranges);
};
/**
 * Gets a human readable string for a TimeRange
 *
 * @param {TimeRange} range
 * @return {string} a human readable string
 */

var printableRange = function printableRange(range) {
  var strArr = [];

  if (!range || !range.length) {
    return '';
  }

  for (var i = 0; i < range.length; i++) {
    strArr.push(range.start(i) + ' => ' + range.end(i));
  }

  return strArr.join(', ');
};
/**
 * Calculates the amount of time left in seconds until the player hits the end of the
 * buffer and causes a rebuffer
 *
 * @param {TimeRange} buffered
 *        The state of the buffer
 * @param {Numnber} currentTime
 *        The current time of the player
 * @param {number} playbackRate
 *        The current playback rate of the player. Defaults to 1.
 * @return {number}
 *         Time until the player has to start rebuffering in seconds.
 * @function timeUntilRebuffer
 */

var timeUntilRebuffer = function timeUntilRebuffer(buffered, currentTime, playbackRate) {
  if (playbackRate === void 0) {
    playbackRate = 1;
  }

  var bufferedEnd = buffered.length ? buffered.end(buffered.length - 1) : 0;
  return (bufferedEnd - currentTime) / playbackRate;
};
/**
 * Converts a TimeRanges object into an array representation
 *
 * @param {TimeRanges} timeRanges
 * @return {Array}
 */

var timeRangesToArray = function timeRangesToArray(timeRanges) {
  var timeRangesList = [];

  for (var i = 0; i < timeRanges.length; i++) {
    timeRangesList.push({
      start: timeRanges.start(i),
      end: timeRanges.end(i)
    });
  }

  return timeRangesList;
};
/**
 * Determines if two time range objects are different.
 *
 * @param {TimeRange} a
 *        the first time range object to check
 *
 * @param {TimeRange} b
 *        the second time range object to check
 *
 * @return {Boolean}
 *         Whether the time range objects differ
 */

var isRangeDifferent = function isRangeDifferent(a, b) {
  // same object
  if (a === b) {
    return false;
  } // one or the other is undefined


  if (!a && b || !b && a) {
    return true;
  } // length is different


  if (a.length !== b.length) {
    return true;
  } // see if any start/end pair is different


  for (var i = 0; i < a.length; i++) {
    if (a.start(i) !== b.start(i) || a.end(i) !== b.end(i)) {
      return true;
    }
  } // if the length and every pair is the same
  // this is the same time range


  return false;
};
var lastBufferedEnd = function lastBufferedEnd(a) {
  if (!a || !a.length || !a.end) {
    return;
  }

  return a.end(a.length - 1);
};
/**
 * A utility function to add up the amount of time in a timeRange
 * after a specified startTime.
 * ie:[[0, 10], [20, 40], [50, 60]] with a startTime 0
 *     would return 40 as there are 40s seconds after 0 in the timeRange
 *
 * @param {TimeRange} range
 *        The range to check against
 * @param {number} startTime
 *        The time in the time range that you should start counting from
 *
 * @return {number}
 *          The number of seconds in the buffer passed the specified time.
 */

var timeAheadOf = function timeAheadOf(range, startTime) {
  var time = 0;

  if (!range || !range.length) {
    return time;
  }

  for (var i = 0; i < range.length; i++) {
    var start = range.start(i);
    var end = range.end(i); // startTime is after this range entirely

    if (startTime > end) {
      continue;
    } // startTime is within this range


    if (startTime > start && startTime <= end) {
      time += end - startTime;
      continue;
    } // startTime is before this range.


    time += end - start;
  }

  return time;
};

/**
 * @file playlist.js
 *
 * Playlist related utilities.
 */
/**
 * Get the duration of a segment, with special cases for
 * llhls segments that do not have a duration yet.
 *
 * @param {Object} playlist
 *        the playlist that the segment belongs to.
 * @param {Object} segment
 *        the segment to get a duration for.
 *
 * @return {number}
 *          the segment duration
 */

var segmentDurationWithParts = function segmentDurationWithParts(playlist, segment) {
  // if this isn't a preload segment
  // then we will have a segment duration that is accurate.
  if (!segment.preload) {
    return segment.duration;
  } // otherwise we have to add up parts and preload hints
  // to get an up to date duration.


  var result = 0;
  (segment.parts || []).forEach(function (p) {
    result += p.duration;
  }); // for preload hints we have to use partTargetDuration
  // as they won't even have a duration yet.

  (segment.preloadHints || []).forEach(function (p) {
    if (p.type === 'PART') {
      result += playlist.partTargetDuration;
    }
  });
  return result;
};
/**
 * A function to get a combined list of parts and segments with durations
 * and indexes.
 *
 * @param {Playlist} playlist the playlist to get the list for.
 *
 * @return {Array} The part/segment list.
 */

var getPartsAndSegments = function getPartsAndSegments(playlist) {
  return (playlist.segments || []).reduce(function (acc, segment, si) {
    if (segment.parts) {
      segment.parts.forEach(function (part, pi) {
        acc.push({
          duration: part.duration,
          segmentIndex: si,
          partIndex: pi,
          part: part,
          segment: segment
        });
      });
    } else {
      acc.push({
        duration: segment.duration,
        segmentIndex: si,
        partIndex: null,
        segment: segment,
        part: null
      });
    }

    return acc;
  }, []);
};
var getLastParts = function getLastParts(media) {
  var lastSegment = media.segments && media.segments.length && media.segments[media.segments.length - 1];
  return lastSegment && lastSegment.parts || [];
};
var getKnownPartCount = function getKnownPartCount(_ref) {
  var preloadSegment = _ref.preloadSegment;

  if (!preloadSegment) {
    return;
  }

  var parts = preloadSegment.parts,
      preloadHints = preloadSegment.preloadHints;
  var partCount = (preloadHints || []).reduce(function (count, hint) {
    return count + (hint.type === 'PART' ? 1 : 0);
  }, 0);
  partCount += parts && parts.length ? parts.length : 0;
  return partCount;
};
/**
 * Get the number of seconds to delay from the end of a
 * live playlist.
 *
 * @param {Playlist} main the main playlist
 * @param {Playlist} media the media playlist
 * @return {number} the hold back in seconds.
 */

var liveEdgeDelay = function liveEdgeDelay(main, media) {
  if (media.endList) {
    return 0;
  } // dash suggestedPresentationDelay trumps everything


  if (main && main.suggestedPresentationDelay) {
    return main.suggestedPresentationDelay;
  }

  var hasParts = getLastParts(media).length > 0; // look for "part" delays from ll-hls first

  if (hasParts && media.serverControl && media.serverControl.partHoldBack) {
    return media.serverControl.partHoldBack;
  } else if (hasParts && media.partTargetDuration) {
    return media.partTargetDuration * 3; // finally look for full segment delays
  } else if (media.serverControl && media.serverControl.holdBack) {
    return media.serverControl.holdBack;
  } else if (media.targetDuration) {
    return media.targetDuration * 3;
  }

  return 0;
};
/**
 * walk backward until we find a duration we can use
 * or return a failure
 *
 * @param {Playlist} playlist the playlist to walk through
 * @param {Number} endSequence the mediaSequence to stop walking on
 */

var backwardDuration = function backwardDuration(playlist, endSequence) {
  var result = 0;
  var i = endSequence - playlist.mediaSequence; // if a start time is available for segment immediately following
  // the interval, use it

  var segment = playlist.segments[i]; // Walk backward until we find the latest segment with timeline
  // information that is earlier than endSequence

  if (segment) {
    if (typeof segment.start !== 'undefined') {
      return {
        result: segment.start,
        precise: true
      };
    }

    if (typeof segment.end !== 'undefined') {
      return {
        result: segment.end - segment.duration,
        precise: true
      };
    }
  }

  while (i--) {
    segment = playlist.segments[i];

    if (typeof segment.end !== 'undefined') {
      return {
        result: result + segment.end,
        precise: true
      };
    }

    result += segmentDurationWithParts(playlist, segment);

    if (typeof segment.start !== 'undefined') {
      return {
        result: result + segment.start,
        precise: true
      };
    }
  }

  return {
    result: result,
    precise: false
  };
};
/**
 * walk forward until we find a duration we can use
 * or return a failure
 *
 * @param {Playlist} playlist the playlist to walk through
 * @param {number} endSequence the mediaSequence to stop walking on
 */


var forwardDuration = function forwardDuration(playlist, endSequence) {
  var result = 0;
  var segment;
  var i = endSequence - playlist.mediaSequence; // Walk forward until we find the earliest segment with timeline
  // information

  for (; i < playlist.segments.length; i++) {
    segment = playlist.segments[i];

    if (typeof segment.start !== 'undefined') {
      return {
        result: segment.start - result,
        precise: true
      };
    }

    result += segmentDurationWithParts(playlist, segment);

    if (typeof segment.end !== 'undefined') {
      return {
        result: segment.end - result,
        precise: true
      };
    }
  } // indicate we didn't find a useful duration estimate


  return {
    result: -1,
    precise: false
  };
};
/**
  * Calculate the media duration from the segments associated with a
  * playlist. The duration of a subinterval of the available segments
  * may be calculated by specifying an end index.
  *
  * @param {Object} playlist a media playlist object
  * @param {number=} endSequence an exclusive upper boundary
  * for the playlist.  Defaults to playlist length.
  * @param {number} expired the amount of time that has dropped
  * off the front of the playlist in a live scenario
  * @return {number} the duration between the first available segment
  * and end index.
  */


var intervalDuration = function intervalDuration(playlist, endSequence, expired) {
  if (typeof endSequence === 'undefined') {
    endSequence = playlist.mediaSequence + playlist.segments.length;
  }

  if (endSequence < playlist.mediaSequence) {
    return 0;
  } // do a backward walk to estimate the duration


  var backward = backwardDuration(playlist, endSequence);

  if (backward.precise) {
    // if we were able to base our duration estimate on timing
    // information provided directly from the Media Source, return
    // it
    return backward.result;
  } // walk forward to see if a precise duration estimate can be made
  // that way


  var forward = forwardDuration(playlist, endSequence);

  if (forward.precise) {
    // we found a segment that has been buffered and so it's
    // position is known precisely
    return forward.result;
  } // return the less-precise, playlist-based duration estimate


  return backward.result + expired;
};
/**
  * Calculates the duration of a playlist. If a start and end index
  * are specified, the duration will be for the subset of the media
  * timeline between those two indices. The total duration for live
  * playlists is always Infinity.
  *
  * @param {Object} playlist a media playlist object
  * @param {number=} endSequence an exclusive upper
  * boundary for the playlist. Defaults to the playlist media
  * sequence number plus its length.
  * @param {number=} expired the amount of time that has
  * dropped off the front of the playlist in a live scenario
  * @return {number} the duration between the start index and end
  * index.
  */


var duration = function duration(playlist, endSequence, expired) {
  if (!playlist) {
    return 0;
  }

  if (typeof expired !== 'number') {
    expired = 0;
  } // if a slice of the total duration is not requested, use
  // playlist-level duration indicators when they're present


  if (typeof endSequence === 'undefined') {
    // if present, use the duration specified in the playlist
    if (playlist.totalDuration) {
      return playlist.totalDuration;
    } // duration should be Infinity for live playlists


    if (!playlist.endList) {
      return window$1.Infinity;
    }
  } // calculate the total duration based on the segment durations


  return intervalDuration(playlist, endSequence, expired);
};
/**
  * Calculate the time between two indexes in the current playlist
  * neight the start- nor the end-index need to be within the current
  * playlist in which case, the targetDuration of the playlist is used
  * to approximate the durations of the segments
  *
  * @param {Array} options.durationList list to iterate over for durations.
  * @param {number} options.defaultDuration duration to use for elements before or after the durationList
  * @param {number} options.startIndex partsAndSegments index to start
  * @param {number} options.endIndex partsAndSegments index to end.
  * @return {number} the number of seconds between startIndex and endIndex
  */

var sumDurations = function sumDurations(_ref2) {
  var defaultDuration = _ref2.defaultDuration,
      durationList = _ref2.durationList,
      startIndex = _ref2.startIndex,
      endIndex = _ref2.endIndex;
  var durations = 0;

  if (startIndex > endIndex) {
    var _ref3 = [endIndex, startIndex];
    startIndex = _ref3[0];
    endIndex = _ref3[1];
  }

  if (startIndex < 0) {
    for (var i = startIndex; i < Math.min(0, endIndex); i++) {
      durations += defaultDuration;
    }

    startIndex = 0;
  }

  for (var _i = startIndex; _i < endIndex; _i++) {
    durations += durationList[_i].duration;
  }

  return durations;
};
/**
 * Calculates the playlist end time
 *
 * @param {Object} playlist a media playlist object
 * @param {number=} expired the amount of time that has
 *                  dropped off the front of the playlist in a live scenario
 * @param {boolean|false} useSafeLiveEnd a boolean value indicating whether or not the
 *                        playlist end calculation should consider the safe live end
 *                        (truncate the playlist end by three segments). This is normally
 *                        used for calculating the end of the playlist's seekable range.
 *                        This takes into account the value of liveEdgePadding.
 *                        Setting liveEdgePadding to 0 is equivalent to setting this to false.
 * @param {number} liveEdgePadding a number indicating how far from the end of the playlist we should be in seconds.
 *                 If this is provided, it is used in the safe live end calculation.
 *                 Setting useSafeLiveEnd=false or liveEdgePadding=0 are equivalent.
 *                 Corresponds to suggestedPresentationDelay in DASH manifests.
 * @return {number} the end time of playlist
 * @function playlistEnd
 */

var playlistEnd = function playlistEnd(playlist, expired, useSafeLiveEnd, liveEdgePadding) {
  if (!playlist || !playlist.segments) {
    return null;
  }

  if (playlist.endList) {
    return duration(playlist);
  }

  if (expired === null) {
    return null;
  }

  expired = expired || 0;
  var lastSegmentEndTime = intervalDuration(playlist, playlist.mediaSequence + playlist.segments.length, expired);

  if (useSafeLiveEnd) {
    liveEdgePadding = typeof liveEdgePadding === 'number' ? liveEdgePadding : liveEdgeDelay(null, playlist);
    lastSegmentEndTime -= liveEdgePadding;
  } // don't return a time less than zero


  return Math.max(0, lastSegmentEndTime);
};
/**
  * Calculates the interval of time that is currently seekable in a
  * playlist. The returned time ranges are relative to the earliest
  * moment in the specified playlist that is still available. A full
  * seekable implementation for live streams would need to offset
  * these values by the duration of content that has expired from the
  * stream.
  *
  * @param {Object} playlist a media playlist object
  * dropped off the front of the playlist in a live scenario
  * @param {number=} expired the amount of time that has
  * dropped off the front of the playlist in a live scenario
  * @param {number} liveEdgePadding how far from the end of the playlist we should be in seconds.
  *        Corresponds to suggestedPresentationDelay in DASH manifests.
  * @return {TimeRanges} the periods of time that are valid targets
  * for seeking
  */

var seekable = function seekable(playlist, expired, liveEdgePadding) {
  var useSafeLiveEnd = true;
  var seekableStart = expired || 0;
  var seekableEnd = playlistEnd(playlist, expired, useSafeLiveEnd, liveEdgePadding);

  if (seekableEnd === null) {
    return createTimeRanges();
  } // Clamp seekable end since it can not be less than the seekable start


  if (seekableEnd < seekableStart) {
    seekableEnd = seekableStart;
  }

  return createTimeRanges(seekableStart, seekableEnd);
};
/**
 * Determine the index and estimated starting time of the segment that
 * contains a specified playback position in a media playlist.
 *
 * @param {Object} options.playlist the media playlist to query
 * @param {number} options.currentTime The number of seconds since the earliest
 * possible position to determine the containing segment for
 * @param {number} options.startTime the time when the segment/part starts
 * @param {number} options.startingSegmentIndex the segment index to start looking at.
 * @param {number?} [options.startingPartIndex] the part index to look at within the segment.
 *
 * @return {Object} an object with partIndex, segmentIndex, and startTime.
 */

var getMediaInfoForTime = function getMediaInfoForTime(_ref4) {
  var playlist = _ref4.playlist,
      currentTime = _ref4.currentTime,
      startingSegmentIndex = _ref4.startingSegmentIndex,
      startingPartIndex = _ref4.startingPartIndex,
      startTime = _ref4.startTime,
      exactManifestTimings = _ref4.exactManifestTimings;
  var time = currentTime - startTime;
  var partsAndSegments = getPartsAndSegments(playlist);
  var startIndex = 0;

  for (var i = 0; i < partsAndSegments.length; i++) {
    var partAndSegment = partsAndSegments[i];

    if (startingSegmentIndex !== partAndSegment.segmentIndex) {
      continue;
    } // skip this if part index does not match.


    if (typeof startingPartIndex === 'number' && typeof partAndSegment.partIndex === 'number' && startingPartIndex !== partAndSegment.partIndex) {
      continue;
    }

    startIndex = i;
    break;
  }

  if (time < 0) {
    // Walk backward from startIndex in the playlist, adding durations
    // until we find a segment that contains `time` and return it
    if (startIndex > 0) {
      for (var _i2 = startIndex - 1; _i2 >= 0; _i2--) {
        var _partAndSegment = partsAndSegments[_i2];
        time += _partAndSegment.duration;

        if (exactManifestTimings) {
          if (time < 0) {
            continue;
          }
        } else if (time + TIME_FUDGE_FACTOR <= 0) {
          continue;
        }

        return {
          partIndex: _partAndSegment.partIndex,
          segmentIndex: _partAndSegment.segmentIndex,
          startTime: startTime - sumDurations({
            defaultDuration: playlist.targetDuration,
            durationList: partsAndSegments,
            startIndex: startIndex,
            endIndex: _i2
          })
        };
      }
    } // We were unable to find a good segment within the playlist
    // so select the first segment


    return {
      partIndex: partsAndSegments[0] && partsAndSegments[0].partIndex || null,
      segmentIndex: partsAndSegments[0] && partsAndSegments[0].segmentIndex || 0,
      startTime: currentTime
    };
  } // When startIndex is negative, we first walk forward to first segment
  // adding target durations. If we "run out of time" before getting to
  // the first segment, return the first segment


  if (startIndex < 0) {
    for (var _i3 = startIndex; _i3 < 0; _i3++) {
      time -= playlist.targetDuration;

      if (time < 0) {
        return {
          partIndex: partsAndSegments[0] && partsAndSegments[0].partIndex || null,
          segmentIndex: partsAndSegments[0] && partsAndSegments[0].segmentIndex || 0,
          startTime: currentTime
        };
      }
    }

    startIndex = 0;
  } // Walk forward from startIndex in the playlist, subtracting durations
  // until we find a segment that contains `time` and return it


  for (var _i4 = startIndex; _i4 < partsAndSegments.length; _i4++) {
    var _partAndSegment2 = partsAndSegments[_i4];
    time -= _partAndSegment2.duration;
    var canUseFudgeFactor = _partAndSegment2.duration > TIME_FUDGE_FACTOR;
    var isExactlyAtTheEnd = time === 0;
    var isExtremelyCloseToTheEnd = canUseFudgeFactor && time + TIME_FUDGE_FACTOR >= 0;

    if (isExactlyAtTheEnd || isExtremelyCloseToTheEnd) {
      // 1) We are exactly at the end of the current segment.
      // 2) We are extremely close to the end of the current segment (The difference is less than  1 / 30).
      //    We may encounter this situation when
      //    we don't have exact match between segment duration info in the manifest and the actual duration of the segment
      //    For example:
      //    We appended 3 segments 10 seconds each, meaning we should have 30 sec buffered,
      //    but we the actual buffered is 29.99999
      //
      // In both cases:
      // if we passed current time -> it means that we already played current segment
      // if we passed buffered.end -> it means that this segment is already loaded and buffered
      // we should select the next segment if we have one:
      if (_i4 !== partsAndSegments.length - 1) {
        continue;
      }
    }

    if (exactManifestTimings) {
      if (time > 0) {
        continue;
      }
    } else if (time - TIME_FUDGE_FACTOR >= 0) {
      continue;
    }

    return {
      partIndex: _partAndSegment2.partIndex,
      segmentIndex: _partAndSegment2.segmentIndex,
      startTime: startTime + sumDurations({
        defaultDuration: playlist.targetDuration,
        durationList: partsAndSegments,
        startIndex: startIndex,
        endIndex: _i4
      })
    };
  } // We are out of possible candidates so load the last one...


  return {
    segmentIndex: partsAndSegments[partsAndSegments.length - 1].segmentIndex,
    partIndex: partsAndSegments[partsAndSegments.length - 1].partIndex,
    startTime: currentTime
  };
};
/**
 * Check whether the playlist is excluded or not.
 *
 * @param {Object} playlist the media playlist object
 * @return {boolean} whether the playlist is excluded or not
 * @function isExcluded
 */

var isExcluded = function isExcluded(playlist) {
  return playlist.excludeUntil && playlist.excludeUntil > Date.now();
};
/**
 * Check whether the playlist is compatible with current playback configuration or has
 * been excluded permanently for being incompatible.
 *
 * @param {Object} playlist the media playlist object
 * @return {boolean} whether the playlist is incompatible or not
 * @function isIncompatible
 */

var isIncompatible = function isIncompatible(playlist) {
  return playlist.excludeUntil && playlist.excludeUntil === Infinity;
};
/**
 * Check whether the playlist is enabled or not.
 *
 * @param {Object} playlist the media playlist object
 * @return {boolean} whether the playlist is enabled or not
 * @function isEnabled
 */

var isEnabled = function isEnabled(playlist) {
  var excluded = isExcluded(playlist);
  return !playlist.disabled && !excluded;
};
/**
 * Check whether the playlist has been manually disabled through the representations api.
 *
 * @param {Object} playlist the media playlist object
 * @return {boolean} whether the playlist is disabled manually or not
 * @function isDisabled
 */

var isDisabled = function isDisabled(playlist) {
  return playlist.disabled;
};
/**
 * Returns whether the current playlist is an AES encrypted HLS stream
 *
 * @return {boolean} true if it's an AES encrypted HLS stream
 */

var isAes = function isAes(media) {
  for (var i = 0; i < media.segments.length; i++) {
    if (media.segments[i].key) {
      return true;
    }
  }

  return false;
};
/**
 * Checks if the playlist has a value for the specified attribute
 *
 * @param {string} attr
 *        Attribute to check for
 * @param {Object} playlist
 *        The media playlist object
 * @return {boolean}
 *         Whether the playlist contains a value for the attribute or not
 * @function hasAttribute
 */

var hasAttribute = function hasAttribute(attr, playlist) {
  return playlist.attributes && playlist.attributes[attr];
};
/**
 * Estimates the time required to complete a segment download from the specified playlist
 *
 * @param {number} segmentDuration
 *        Duration of requested segment
 * @param {number} bandwidth
 *        Current measured bandwidth of the player
 * @param {Object} playlist
 *        The media playlist object
 * @param {number=} bytesReceived
 *        Number of bytes already received for the request. Defaults to 0
 * @return {number|NaN}
 *         The estimated time to request the segment. NaN if bandwidth information for
 *         the given playlist is unavailable
 * @function estimateSegmentRequestTime
 */

var estimateSegmentRequestTime = function estimateSegmentRequestTime(segmentDuration, bandwidth, playlist, bytesReceived) {
  if (bytesReceived === void 0) {
    bytesReceived = 0;
  }

  if (!hasAttribute('BANDWIDTH', playlist)) {
    return NaN;
  }

  var size = segmentDuration * playlist.attributes.BANDWIDTH;
  return (size - bytesReceived * 8) / bandwidth;
};
/*
 * Returns whether the current playlist is the lowest rendition
 *
 * @return {Boolean} true if on lowest rendition
 */

var isLowestEnabledRendition = function isLowestEnabledRendition(main, media) {
  if (main.playlists.length === 1) {
    return true;
  }

  var currentBandwidth = media.attributes.BANDWIDTH || Number.MAX_VALUE;
  return main.playlists.filter(function (playlist) {
    if (!isEnabled(playlist)) {
      return false;
    }

    return (playlist.attributes.BANDWIDTH || 0) < currentBandwidth;
  }).length === 0;
};
var playlistMatch = function playlistMatch(a, b) {
  // both playlits are null
  // or only one playlist is non-null
  // no match
  if (!a && !b || !a && b || a && !b) {
    return false;
  } // playlist objects are the same, match


  if (a === b) {
    return true;
  } // first try to use id as it should be the most
  // accurate


  if (a.id && b.id && a.id === b.id) {
    return true;
  } // next try to use reslovedUri as it should be the
  // second most accurate.


  if (a.resolvedUri && b.resolvedUri && a.resolvedUri === b.resolvedUri) {
    return true;
  } // finally try to use uri as it should be accurate
  // but might miss a few cases for relative uris


  if (a.uri && b.uri && a.uri === b.uri) {
    return true;
  }

  return false;
};

var someAudioVariant = function someAudioVariant(main, callback) {
  var AUDIO = main && main.mediaGroups && main.mediaGroups.AUDIO || {};
  var found = false;

  for (var groupName in AUDIO) {
    for (var label in AUDIO[groupName]) {
      found = callback(AUDIO[groupName][label]);

      if (found) {
        break;
      }
    }

    if (found) {
      break;
    }
  }

  return !!found;
};

var isAudioOnly = function isAudioOnly(main) {
  // we are audio only if we have no main playlists but do
  // have media group playlists.
  if (!main || !main.playlists || !main.playlists.length) {
    // without audio variants or playlists this
    // is not an audio only main.
    var found = someAudioVariant(main, function (variant) {
      return variant.playlists && variant.playlists.length || variant.uri;
    });
    return found;
  } // if every playlist has only an audio codec it is audio only


  var _loop = function _loop(i) {
    var playlist = main.playlists[i];
    var CODECS = playlist.attributes && playlist.attributes.CODECS; // all codecs are audio, this is an audio playlist.

    if (CODECS && CODECS.split(',').every(function (c) {
      return isAudioCodec(c);
    })) {
      return "continue";
    } // playlist is in an audio group it is audio only


    var found = someAudioVariant(main, function (variant) {
      return playlistMatch(playlist, variant);
    });

    if (found) {
      return "continue";
    } // if we make it here this playlist isn't audio and we
    // are not audio only


    return {
      v: false
    };
  };

  for (var i = 0; i < main.playlists.length; i++) {
    var _ret = _loop(i);

    if (_ret === "continue") continue;
    if (typeof _ret === "object") return _ret.v;
  } // if we make it past every playlist without returning, then
  // this is an audio only playlist.


  return true;
}; // exports

var Playlist = {
  liveEdgeDelay: liveEdgeDelay,
  duration: duration,
  seekable: seekable,
  getMediaInfoForTime: getMediaInfoForTime,
  isEnabled: isEnabled,
  isDisabled: isDisabled,
  isExcluded: isExcluded,
  isIncompatible: isIncompatible,
  playlistEnd: playlistEnd,
  isAes: isAes,
  hasAttribute: hasAttribute,
  estimateSegmentRequestTime: estimateSegmentRequestTime,
  isLowestEnabledRendition: isLowestEnabledRendition,
  isAudioOnly: isAudioOnly,
  playlistMatch: playlistMatch,
  segmentDurationWithParts: segmentDurationWithParts
};

var log = videojs.log;
var createPlaylistID = function createPlaylistID(index, uri) {
  return index + "-" + uri;
}; // default function for creating a group id

var groupID = function groupID(type, group, label) {
  return "placeholder-uri-" + type + "-" + group + "-" + label;
};
/**
 * Parses a given m3u8 playlist
 *
 * @param {Function} [onwarn]
 *        a function to call when the parser triggers a warning event.
 * @param {Function} [oninfo]
 *        a function to call when the parser triggers an info event.
 * @param {string} manifestString
 *        The downloaded manifest string
 * @param {Object[]} [customTagParsers]
 *        An array of custom tag parsers for the m3u8-parser instance
 * @param {Object[]} [customTagMappers]
 *        An array of custom tag mappers for the m3u8-parser instance
 * @param {boolean} [llhls]
 *        Whether to keep ll-hls features in the manifest after parsing.
 * @return {Object}
 *         The manifest object
 */

var parseManifest = function parseManifest(_ref) {
  var onwarn = _ref.onwarn,
      oninfo = _ref.oninfo,
      manifestString = _ref.manifestString,
      _ref$customTagParsers = _ref.customTagParsers,
      customTagParsers = _ref$customTagParsers === void 0 ? [] : _ref$customTagParsers,
      _ref$customTagMappers = _ref.customTagMappers,
      customTagMappers = _ref$customTagMappers === void 0 ? [] : _ref$customTagMappers,
      llhls = _ref.llhls;
  var parser = new Parser();

  if (onwarn) {
    parser.on('warn', onwarn);
  }

  if (oninfo) {
    parser.on('info', oninfo);
  }

  customTagParsers.forEach(function (customParser) {
    return parser.addParser(customParser);
  });
  customTagMappers.forEach(function (mapper) {
    return parser.addTagMapper(mapper);
  });
  parser.push(manifestString);
  parser.end();
  var manifest = parser.manifest; // remove llhls features from the parsed manifest
  // if we don't want llhls support.

  if (!llhls) {
    ['preloadSegment', 'skip', 'serverControl', 'renditionReports', 'partInf', 'partTargetDuration'].forEach(function (k) {
      if (manifest.hasOwnProperty(k)) {
        delete manifest[k];
      }
    });

    if (manifest.segments) {
      manifest.segments.forEach(function (segment) {
        ['parts', 'preloadHints'].forEach(function (k) {
          if (segment.hasOwnProperty(k)) {
            delete segment[k];
          }
        });
      });
    }
  }

  if (!manifest.targetDuration) {
    var targetDuration = 10;

    if (manifest.segments && manifest.segments.length) {
      targetDuration = manifest.segments.reduce(function (acc, s) {
        return Math.max(acc, s.duration);
      }, 0);
    }

    if (onwarn) {
      onwarn({
        message: "manifest has no targetDuration defaulting to " + targetDuration
      });
    }

    manifest.targetDuration = targetDuration;
  }

  var parts = getLastParts(manifest);

  if (parts.length && !manifest.partTargetDuration) {
    var partTargetDuration = parts.reduce(function (acc, p) {
      return Math.max(acc, p.duration);
    }, 0);

    if (onwarn) {
      onwarn({
        message: "manifest has no partTargetDuration defaulting to " + partTargetDuration
      });
      log.error('LL-HLS manifest has parts but lacks required #EXT-X-PART-INF:PART-TARGET value. See https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-09#section-4.4.3.7. Playback is not guaranteed.');
    }

    manifest.partTargetDuration = partTargetDuration;
  }

  return manifest;
};
/**
 * Loops through all supported media groups in main and calls the provided
 * callback for each group
 *
 * @param {Object} main
 *        The parsed main manifest object
 * @param {Function} callback
 *        Callback to call for each media group
 */

var forEachMediaGroup = function forEachMediaGroup(main, callback) {
  if (!main.mediaGroups) {
    return;
  }

  ['AUDIO', 'SUBTITLES'].forEach(function (mediaType) {
    if (!main.mediaGroups[mediaType]) {
      return;
    }

    for (var groupKey in main.mediaGroups[mediaType]) {
      for (var labelKey in main.mediaGroups[mediaType][groupKey]) {
        var mediaProperties = main.mediaGroups[mediaType][groupKey][labelKey];
        callback(mediaProperties, mediaType, groupKey, labelKey);
      }
    }
  });
};
/**
 * Adds properties and attributes to the playlist to keep consistent functionality for
 * playlists throughout VHS.
 *
 * @param {Object} config
 *        Arguments object
 * @param {Object} config.playlist
 *        The media playlist
 * @param {string} [config.uri]
 *        The uri to the media playlist (if media playlist is not from within a main
 *        playlist)
 * @param {string} id
 *        ID to use for the playlist
 */

var setupMediaPlaylist = function setupMediaPlaylist(_ref2) {
  var playlist = _ref2.playlist,
      uri = _ref2.uri,
      id = _ref2.id;
  playlist.id = id;
  playlist.playlistErrors_ = 0;

  if (uri) {
    // For media playlists, m3u8-parser does not have access to a URI, as HLS media
    // playlists do not contain their own source URI, but one is needed for consistency in
    // VHS.
    playlist.uri = uri;
  } // For HLS main playlists, even though certain attributes MUST be defined, the
  // stream may still be played without them.
  // For HLS media playlists, m3u8-parser does not attach an attributes object to the
  // manifest.
  //
  // To avoid undefined reference errors through the project, and make the code easier
  // to write/read, add an empty attributes object for these cases.


  playlist.attributes = playlist.attributes || {};
};
/**
 * Adds ID, resolvedUri, and attributes properties to each playlist of the main, where
 * necessary. In addition, creates playlist IDs for each playlist and adds playlist ID to
 * playlist references to the playlists array.
 *
 * @param {Object} main
 *        The main playlist
 */

var setupMediaPlaylists = function setupMediaPlaylists(main) {
  var i = main.playlists.length;

  while (i--) {
    var playlist = main.playlists[i];
    setupMediaPlaylist({
      playlist: playlist,
      id: createPlaylistID(i, playlist.uri)
    });
    playlist.resolvedUri = resolveUrl(main.uri, playlist.uri);
    main.playlists[playlist.id] = playlist; // URI reference added for backwards compatibility

    main.playlists[playlist.uri] = playlist; // Although the spec states an #EXT-X-STREAM-INF tag MUST have a BANDWIDTH attribute,
    // the stream can be played without it. Although an attributes property may have been
    // added to the playlist to prevent undefined references, issue a warning to fix the
    // manifest.

    if (!playlist.attributes.BANDWIDTH) {
      log.warn('Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.');
    }
  }
};
/**
 * Adds resolvedUri properties to each media group.
 *
 * @param {Object} main
 *        The main playlist
 */

var resolveMediaGroupUris = function resolveMediaGroupUris(main) {
  forEachMediaGroup(main, function (properties) {
    if (properties.uri) {
      properties.resolvedUri = resolveUrl(main.uri, properties.uri);
    }
  });
};
/**
 * Creates a main playlist wrapper to insert a sole media playlist into.
 *
 * @param {Object} media
 *        Media playlist
 * @param {string} uri
 *        The media URI
 *
 * @return {Object}
 *         main playlist
 */

var mainForMedia = function mainForMedia(media, uri) {
  var id = createPlaylistID(0, uri);
  var main = {
    mediaGroups: {
      'AUDIO': {},
      'VIDEO': {},
      'CLOSED-CAPTIONS': {},
      'SUBTITLES': {}
    },
    uri: window$1.location.href,
    resolvedUri: window$1.location.href,
    playlists: [{
      uri: uri,
      id: id,
      resolvedUri: uri,
      // m3u8-parser does not attach an attributes property to media playlists so make
      // sure that the property is attached to avoid undefined reference errors
      attributes: {}
    }]
  }; // set up ID reference

  main.playlists[id] = main.playlists[0]; // URI reference added for backwards compatibility

  main.playlists[uri] = main.playlists[0];
  return main;
};
/**
 * Does an in-place update of the main manifest to add updated playlist URI references
 * as well as other properties needed by VHS that aren't included by the parser.
 *
 * @param {Object} main
 *        main manifest object
 * @param {string} uri
 *        The source URI
 * @param {function} createGroupID
 *        A function to determine how to create the groupID for mediaGroups
 */

var addPropertiesToMain = function addPropertiesToMain(main, uri, createGroupID) {
  if (createGroupID === void 0) {
    createGroupID = groupID;
  }

  main.uri = uri;

  for (var i = 0; i < main.playlists.length; i++) {
    if (!main.playlists[i].uri) {
      // Set up phony URIs for the playlists since playlists are referenced by their URIs
      // throughout VHS, but some formats (e.g., DASH) don't have external URIs
      // TODO: consider adding dummy URIs in mpd-parser
      var phonyUri = "placeholder-uri-" + i;
      main.playlists[i].uri = phonyUri;
    }
  }

  var audioOnlyMain = isAudioOnly(main);
  forEachMediaGroup(main, function (properties, mediaType, groupKey, labelKey) {
    // add a playlist array under properties
    if (!properties.playlists || !properties.playlists.length) {
      // If the manifest is audio only and this media group does not have a uri, check
      // if the media group is located in the main list of playlists. If it is, don't add
      // placeholder properties as it shouldn't be considered an alternate audio track.
      if (audioOnlyMain && mediaType === 'AUDIO' && !properties.uri) {
        for (var _i = 0; _i < main.playlists.length; _i++) {
          var p = main.playlists[_i];

          if (p.attributes && p.attributes.AUDIO && p.attributes.AUDIO === groupKey) {
            return;
          }
        }
      }

      properties.playlists = [_extends({}, properties)];
    }

    properties.playlists.forEach(function (p, i) {
      var groupId = createGroupID(mediaType, groupKey, labelKey, p);
      var id = createPlaylistID(i, groupId);

      if (p.uri) {
        p.resolvedUri = p.resolvedUri || resolveUrl(main.uri, p.uri);
      } else {
        // DEPRECATED, this has been added to prevent a breaking change.
        // previously we only ever had a single media group playlist, so
        // we mark the first playlist uri without prepending the index as we used to
        // ideally we would do all of the playlists the same way.
        p.uri = i === 0 ? groupId : id; // don't resolve a placeholder uri to an absolute url, just use
        // the placeholder again

        p.resolvedUri = p.uri;
      }

      p.id = p.id || id; // add an empty attributes object, all playlists are
      // expected to have this.

      p.attributes = p.attributes || {}; // setup ID and URI references (URI for backwards compatibility)

      main.playlists[p.id] = p;
      main.playlists[p.uri] = p;
    });
  });
  setupMediaPlaylists(main);
  resolveMediaGroupUris(main);
};

var DateRangesStorage = /*#__PURE__*/function () {
  function DateRangesStorage() {
    this.offset_ = null;
    this.pendingDateRanges_ = new Map();
    this.processedDateRanges_ = new Map();
  }

  var _proto = DateRangesStorage.prototype;

  _proto.setOffset = function setOffset(segments) {
    if (segments === void 0) {
      segments = [];
    }

    // already set
    if (this.offset_ !== null) {
      return;
    } // no segment to process


    if (!segments.length) {
      return;
    }

    var _segments = segments,
        firstSegment = _segments[0]; // no program date time

    if (firstSegment.programDateTime === undefined) {
      return;
    } // Set offset as ProgramDateTime for the very first segment of the very first playlist load:


    this.offset_ = firstSegment.programDateTime / 1000;
  };

  _proto.setPendingDateRanges = function setPendingDateRanges(dateRanges) {
    if (dateRanges === void 0) {
      dateRanges = [];
    }

    if (!dateRanges.length) {
      return;
    }

    var _dateRanges = dateRanges,
        dateRange = _dateRanges[0];
    var startTime = dateRange.startDate.getTime();
    this.trimProcessedDateRanges_(startTime);
    this.pendingDateRanges_ = dateRanges.reduce(function (map, pendingDateRange) {
      map.set(pendingDateRange.id, pendingDateRange);
      return map;
    }, new Map());
  };

  _proto.processDateRange = function processDateRange(dateRange) {
    this.pendingDateRanges_.delete(dateRange.id);
    this.processedDateRanges_.set(dateRange.id, dateRange);
  };

  _proto.getDateRangesToProcess = function getDateRangesToProcess() {
    var _this = this;

    if (this.offset_ === null) {
      return [];
    }

    var dateRangeClasses = {};
    var dateRangesToProcess = [];
    this.pendingDateRanges_.forEach(function (dateRange, id) {
      if (_this.processedDateRanges_.has(id)) {
        return;
      }

      dateRange.startTime = dateRange.startDate.getTime() / 1000 - _this.offset_;

      dateRange.processDateRange = function () {
        return _this.processDateRange(dateRange);
      };

      dateRangesToProcess.push(dateRange);

      if (!dateRange.class) {
        return;
      }

      if (dateRangeClasses[dateRange.class]) {
        var length = dateRangeClasses[dateRange.class].push(dateRange);
        dateRange.classListIndex = length - 1;
      } else {
        dateRangeClasses[dateRange.class] = [dateRange];
        dateRange.classListIndex = 0;
      }
    });

    for (var _i = 0, _dateRangesToProcess = dateRangesToProcess; _i < _dateRangesToProcess.length; _i++) {
      var dateRange = _dateRangesToProcess[_i];
      var classList = dateRangeClasses[dateRange.class] || [];

      if (dateRange.endDate) {
        dateRange.endTime = dateRange.endDate.getTime() / 1000 - this.offset_;
      } else if (dateRange.endOnNext && classList[dateRange.classListIndex + 1]) {
        dateRange.endTime = classList[dateRange.classListIndex + 1].startTime;
      } else if (dateRange.duration) {
        dateRange.endTime = dateRange.startTime + dateRange.duration;
      } else if (dateRange.plannedDuration) {
        dateRange.endTime = dateRange.startTime + dateRange.plannedDuration;
      } else {
        dateRange.endTime = dateRange.startTime;
      }
    }

    return dateRangesToProcess;
  };

  _proto.trimProcessedDateRanges_ = function trimProcessedDateRanges_(startTime) {
    var _this2 = this;

    var copy = new Map(this.processedDateRanges_);
    copy.forEach(function (dateRange, id) {
      if (dateRange.startDate.getTime() < startTime) {
        _this2.processedDateRanges_.delete(id);
      }
    });
  };

  return DateRangesStorage;
}();

var EventTarget$1 = videojs.EventTarget;

var addLLHLSQueryDirectives = function addLLHLSQueryDirectives(uri, media) {
  if (media.endList || !media.serverControl) {
    return uri;
  }

  var parameters = {};

  if (media.serverControl.canBlockReload) {
    var preloadSegment = media.preloadSegment; // next msn is a zero based value, length is not.

    var nextMSN = media.mediaSequence + media.segments.length; // If preload segment has parts then it is likely
    // that we are going to request a part of that preload segment.
    // the logic below is used to determine that.

    if (preloadSegment) {
      var parts = preloadSegment.parts || []; // _HLS_part is a zero based index

      var nextPart = getKnownPartCount(media) - 1; // if nextPart is > -1 and not equal to just the
      // length of parts, then we know we had part preload hints
      // and we need to add the _HLS_part= query

      if (nextPart > -1 && nextPart !== parts.length - 1) {
        // add existing parts to our preload hints
        // eslint-disable-next-line
        parameters._HLS_part = nextPart;
      } // this if statement makes sure that we request the msn
      // of the preload segment if:
      // 1. the preload segment had parts (and was not yet a full segment)
      //    but was added to our segments array
      // 2. the preload segment had preload hints for parts that are not in
      //    the manifest yet.
      // in all other cases we want the segment after the preload segment
      // which will be given by using media.segments.length because it is 1 based
      // rather than 0 based.


      if (nextPart > -1 || parts.length) {
        nextMSN--;
      }
    } // add _HLS_msn= in front of any _HLS_part query
    // eslint-disable-next-line


    parameters._HLS_msn = nextMSN;
  }

  if (media.serverControl && media.serverControl.canSkipUntil) {
    // add _HLS_skip= infront of all other queries.
    // eslint-disable-next-line
    parameters._HLS_skip = media.serverControl.canSkipDateranges ? 'v2' : 'YES';
  }

  if (Object.keys(parameters).length) {
    var parsedUri = new window$1.URL(uri);
    ['_HLS_skip', '_HLS_msn', '_HLS_part'].forEach(function (name) {
      if (!parameters.hasOwnProperty(name)) {
        return;
      }

      parsedUri.searchParams.set(name, parameters[name]);
    });
    uri = parsedUri.toString();
  }

  return uri;
};
/**
 * Returns a new segment object with properties and
 * the parts array merged.
 *
 * @param {Object} a the old segment
 * @param {Object} b the new segment
 *
 * @return {Object} the merged segment
 */


var updateSegment = function updateSegment(a, b) {
  if (!a) {
    return b;
  }

  var result = merge(a, b); // if only the old segment has preload hints
  // and the new one does not, remove preload hints.

  if (a.preloadHints && !b.preloadHints) {
    delete result.preloadHints;
  } // if only the old segment has parts
  // then the parts are no longer valid


  if (a.parts && !b.parts) {
    delete result.parts; // if both segments have parts
    // copy part propeties from the old segment
    // to the new one.
  } else if (a.parts && b.parts) {
    for (var i = 0; i < b.parts.length; i++) {
      if (a.parts && a.parts[i]) {
        result.parts[i] = merge(a.parts[i], b.parts[i]);
      }
    }
  } // set skipped to false for segments that have
  // have had information merged from the old segment.


  if (!a.skipped && b.skipped) {
    result.skipped = false;
  } // set preload to false for segments that have
  // had information added in the new segment.


  if (a.preload && !b.preload) {
    result.preload = false;
  }

  return result;
};
/**
 * Returns a new array of segments that is the result of merging
 * properties from an older list of segments onto an updated
 * list. No properties on the updated playlist will be ovewritten.
 *
 * @param {Array} original the outdated list of segments
 * @param {Array} update the updated list of segments
 * @param {number=} offset the index of the first update
 * segment in the original segment list. For non-live playlists,
 * this should always be zero and does not need to be
 * specified. For live playlists, it should be the difference
 * between the media sequence numbers in the original and updated
 * playlists.
 * @return {Array} a list of merged segment objects
 */

var updateSegments = function updateSegments(original, update, offset) {
  var oldSegments = original.slice();
  var newSegments = update.slice();
  offset = offset || 0;
  var result = [];
  var currentMap;

  for (var newIndex = 0; newIndex < newSegments.length; newIndex++) {
    var oldSegment = oldSegments[newIndex + offset];
    var newSegment = newSegments[newIndex];

    if (oldSegment) {
      currentMap = oldSegment.map || currentMap;
      result.push(updateSegment(oldSegment, newSegment));
    } else {
      // carry over map to new segment if it is missing
      if (currentMap && !newSegment.map) {
        newSegment.map = currentMap;
      }

      result.push(newSegment);
    }
  }

  return result;
};
var resolveSegmentUris = function resolveSegmentUris(segment, baseUri) {
  // preloadSegment will not have a uri at all
  // as the segment isn't actually in the manifest yet, only parts
  if (!segment.resolvedUri && segment.uri) {
    segment.resolvedUri = resolveUrl(baseUri, segment.uri);
  }

  if (segment.key && !segment.key.resolvedUri) {
    segment.key.resolvedUri = resolveUrl(baseUri, segment.key.uri);
  }

  if (segment.map && !segment.map.resolvedUri) {
    segment.map.resolvedUri = resolveUrl(baseUri, segment.map.uri);
  }

  if (segment.map && segment.map.key && !segment.map.key.resolvedUri) {
    segment.map.key.resolvedUri = resolveUrl(baseUri, segment.map.key.uri);
  }

  if (segment.parts && segment.parts.length) {
    segment.parts.forEach(function (p) {
      if (p.resolvedUri) {
        return;
      }

      p.resolvedUri = resolveUrl(baseUri, p.uri);
    });
  }

  if (segment.preloadHints && segment.preloadHints.length) {
    segment.preloadHints.forEach(function (p) {
      if (p.resolvedUri) {
        return;
      }

      p.resolvedUri = resolveUrl(baseUri, p.uri);
    });
  }
};

var getAllSegments = function getAllSegments(media) {
  var segments = media.segments || [];
  var preloadSegment = media.preloadSegment; // a preloadSegment with only preloadHints is not currently
  // a usable segment, only include a preloadSegment that has
  // parts.

  if (preloadSegment && preloadSegment.parts && preloadSegment.parts.length) {
    // if preloadHints has a MAP that means that the
    // init segment is going to change. We cannot use any of the parts
    // from this preload segment.
    if (preloadSegment.preloadHints) {
      for (var i = 0; i < preloadSegment.preloadHints.length; i++) {
        if (preloadSegment.preloadHints[i].type === 'MAP') {
          return segments;
        }
      }
    } // set the duration for our preload segment to target duration.


    preloadSegment.duration = media.targetDuration;
    preloadSegment.preload = true;
    segments.push(preloadSegment);
  }

  return segments;
}; // consider the playlist unchanged if the playlist object is the same or
// the number of segments is equal, the media sequence number is unchanged,
// and this playlist hasn't become the end of the playlist


var isPlaylistUnchanged = function isPlaylistUnchanged(a, b) {
  return a === b || a.segments && b.segments && a.segments.length === b.segments.length && a.endList === b.endList && a.mediaSequence === b.mediaSequence && a.preloadSegment === b.preloadSegment;
};
/**
  * Returns a new main playlist that is the result of merging an
  * updated media playlist into the original version. If the
  * updated media playlist does not match any of the playlist
  * entries in the original main playlist, null is returned.
  *
  * @param {Object} main a parsed main M3U8 object
  * @param {Object} media a parsed media M3U8 object
  * @return {Object} a new object that represents the original
  * main playlist with the updated media playlist merged in, or
  * null if the merge produced no change.
  */

var updateMain$1 = function updateMain(main, newMedia, unchangedCheck) {
  if (unchangedCheck === void 0) {
    unchangedCheck = isPlaylistUnchanged;
  }

  var result = merge(main, {});
  var oldMedia = result.playlists[newMedia.id];

  if (!oldMedia) {
    return null;
  }

  if (unchangedCheck(oldMedia, newMedia)) {
    return null;
  }

  newMedia.segments = getAllSegments(newMedia);
  var mergedPlaylist = merge(oldMedia, newMedia); // always use the new media's preload segment

  if (mergedPlaylist.preloadSegment && !newMedia.preloadSegment) {
    delete mergedPlaylist.preloadSegment;
  } // if the update could overlap existing segment information, merge the two segment lists


  if (oldMedia.segments) {
    if (newMedia.skip) {
      newMedia.segments = newMedia.segments || []; // add back in objects for skipped segments, so that we merge
      // old properties into the new segments

      for (var i = 0; i < newMedia.skip.skippedSegments; i++) {
        newMedia.segments.unshift({
          skipped: true
        });
      }
    }

    mergedPlaylist.segments = updateSegments(oldMedia.segments, newMedia.segments, newMedia.mediaSequence - oldMedia.mediaSequence);
  } // resolve any segment URIs to prevent us from having to do it later


  mergedPlaylist.segments.forEach(function (segment) {
    resolveSegmentUris(segment, mergedPlaylist.resolvedUri);
  }); // TODO Right now in the playlists array there are two references to each playlist, one
  // that is referenced by index, and one by URI. The index reference may no longer be
  // necessary.

  for (var _i = 0; _i < result.playlists.length; _i++) {
    if (result.playlists[_i].id === newMedia.id) {
      result.playlists[_i] = mergedPlaylist;
    }
  }

  result.playlists[newMedia.id] = mergedPlaylist; // URI reference added for backwards compatibility

  result.playlists[newMedia.uri] = mergedPlaylist; // update media group playlist references.

  forEachMediaGroup(main, function (properties, mediaType, groupKey, labelKey) {
    if (!properties.playlists) {
      return;
    }

    for (var _i2 = 0; _i2 < properties.playlists.length; _i2++) {
      if (newMedia.id === properties.playlists[_i2].id) {
        properties.playlists[_i2] = mergedPlaylist;
      }
    }
  });
  return result;
};
/**
 * Calculates the time to wait before refreshing a live playlist
 *
 * @param {Object} media
 *        The current media
 * @param {boolean} update
 *        True if there were any updates from the last refresh, false otherwise
 * @return {number}
 *         The time in ms to wait before refreshing the live playlist
 */

var refreshDelay = function refreshDelay(media, update) {
  var segments = media.segments || [];
  var lastSegment = segments[segments.length - 1];
  var lastPart = lastSegment && lastSegment.parts && lastSegment.parts[lastSegment.parts.length - 1];
  var lastDuration = lastPart && lastPart.duration || lastSegment && lastSegment.duration;

  if (update && lastDuration) {
    return lastDuration * 1000;
  } // if the playlist is unchanged since the last reload or last segment duration
  // cannot be determined, try again after half the target duration


  return (media.partTargetDuration || media.targetDuration || 10) * 500;
};
/**
 * Load a playlist from a remote location
 *
 * @class PlaylistLoader
 * @extends Stream
 * @param {string|Object} src url or object of manifest
 * @param {boolean} withCredentials the withCredentials xhr option
 * @class
 */

var PlaylistLoader = /*#__PURE__*/function (_EventTarget) {
  _inheritsLoose(PlaylistLoader, _EventTarget);

  function PlaylistLoader(src, vhs, options) {
    var _this;

    if (options === void 0) {
      options = {};
    }

    _this = _EventTarget.call(this) || this;

    if (!src) {
      throw new Error('A non-empty playlist URL or object is required');
    }

    _this.logger_ = logger('PlaylistLoader');
    var _options = options,
        _options$withCredenti = _options.withCredentials,
        withCredentials = _options$withCredenti === void 0 ? false : _options$withCredenti;
    _this.src = src;
    _this.vhs_ = vhs;
    _this.withCredentials = withCredentials;
    _this.addDateRangesToTextTrack_ = options.addDateRangesToTextTrack;
    var vhsOptions = vhs.options_;
    _this.customTagParsers = vhsOptions && vhsOptions.customTagParsers || [];
    _this.customTagMappers = vhsOptions && vhsOptions.customTagMappers || [];
    _this.llhls = vhsOptions && vhsOptions.llhls;
    _this.dateRangesStorage_ = new DateRangesStorage(); // initialize the loader state

    _this.state = 'HAVE_NOTHING'; // live playlist staleness timeout

    _this.handleMediaupdatetimeout_ = _this.handleMediaupdatetimeout_.bind(_assertThisInitialized(_this));

    _this.on('mediaupdatetimeout', _this.handleMediaupdatetimeout_);

    _this.on('loadedplaylist', _this.handleLoadedPlaylist_.bind(_assertThisInitialized(_this)));

    return _this;
  }

  var _proto = PlaylistLoader.prototype;

  _proto.handleLoadedPlaylist_ = function handleLoadedPlaylist_() {
    var mediaPlaylist = this.media();

    if (!mediaPlaylist) {
      return;
    }

    this.dateRangesStorage_.setOffset(mediaPlaylist.segments);
    this.dateRangesStorage_.setPendingDateRanges(mediaPlaylist.dateRanges);
    var availableDateRanges = this.dateRangesStorage_.getDateRangesToProcess();

    if (!availableDateRanges.length || !this.addDateRangesToTextTrack_) {
      return;
    }

    this.addDateRangesToTextTrack_(availableDateRanges);
  };

  _proto.handleMediaupdatetimeout_ = function handleMediaupdatetimeout_() {
    var _this2 = this;

    if (this.state !== 'HAVE_METADATA') {
      // only refresh the media playlist if no other activity is going on
      return;
    }

    var media = this.media();
    var uri = resolveUrl(this.main.uri, media.uri);

    if (this.llhls) {
      uri = addLLHLSQueryDirectives(uri, media);
    }

    this.state = 'HAVE_CURRENT_METADATA';
    this.request = this.vhs_.xhr({
      uri: uri,
      withCredentials: this.withCredentials,
      requestType: 'hls-playlist'
    }, function (error, req) {
      // disposed
      if (!_this2.request) {
        return;
      }

      if (error) {
        return _this2.playlistRequestError(_this2.request, _this2.media(), 'HAVE_METADATA');
      }

      _this2.haveMetadata({
        playlistString: _this2.request.responseText,
        url: _this2.media().uri,
        id: _this2.media().id
      });
    });
  };

  _proto.playlistRequestError = function playlistRequestError(xhr, playlist, startingState) {
    var uri = playlist.uri,
        id = playlist.id; // any in-flight request is now finished

    this.request = null;

    if (startingState) {
      this.state = startingState;
    }

    this.error = {
      playlist: this.main.playlists[id],
      status: xhr.status,
      message: "HLS playlist request error at URL: " + uri + ".",
      responseText: xhr.responseText,
      code: xhr.status >= 500 ? 4 : 2,
      metadata: {
        errorType: videojs.Error.HlsPlaylistRequestError
      }
    };
    this.trigger('error');
  };

  _proto.parseManifest_ = function parseManifest_(_ref) {
    var _this3 = this;

    var url = _ref.url,
        manifestString = _ref.manifestString;
    return parseManifest({
      onwarn: function onwarn(_ref2) {
        var message = _ref2.message;
        return _this3.logger_("m3u8-parser warn for " + url + ": " + message);
      },
      oninfo: function oninfo(_ref3) {
        var message = _ref3.message;
        return _this3.logger_("m3u8-parser info for " + url + ": " + message);
      },
      manifestString: manifestString,
      customTagParsers: this.customTagParsers,
      customTagMappers: this.customTagMappers,
      llhls: this.llhls
    });
  }
  /**
   * Update the playlist loader's state in response to a new or updated playlist.
   *
   * @param {string} [playlistString]
   *        Playlist string (if playlistObject is not provided)
   * @param {Object} [playlistObject]
   *        Playlist object (if playlistString is not provided)
   * @param {string} url
   *        URL of playlist
   * @param {string} id
   *        ID to use for playlist
   */
  ;

  _proto.haveMetadata = function haveMetadata(_ref4) {
    var playlistString = _ref4.playlistString,
        playlistObject = _ref4.playlistObject,
        url = _ref4.url,
        id = _ref4.id;
    // any in-flight request is now finished
    this.request = null;
    this.state = 'HAVE_METADATA';
    var playlist = playlistObject || this.parseManifest_({
      url: url,
      manifestString: playlistString
    });
    playlist.lastRequest = Date.now();
    setupMediaPlaylist({
      playlist: playlist,
      uri: url,
      id: id
    }); // merge this playlist into the main manifest

    var update = updateMain$1(this.main, playlist);
    this.targetDuration = playlist.partTargetDuration || playlist.targetDuration;
    this.pendingMedia_ = null;

    if (update) {
      this.main = update;
      this.media_ = this.main.playlists[id];
    } else {
      this.trigger('playlistunchanged');
    }

    this.updateMediaUpdateTimeout_(refreshDelay(this.media(), !!update));
    this.trigger('loadedplaylist');
  }
  /**
    * Abort any outstanding work and clean up.
    */
  ;

  _proto.dispose = function dispose() {
    this.trigger('dispose');
    this.stopRequest();
    window$1.clearTimeout(this.mediaUpdateTimeout);
    window$1.clearTimeout(this.finalRenditionTimeout);
    this.dateRangesStorage_ = new DateRangesStorage();
    this.off();
  };

  _proto.stopRequest = function stopRequest() {
    if (this.request) {
      var oldRequest = this.request;
      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  }
  /**
    * When called without any arguments, returns the currently
    * active media playlist. When called with a single argument,
    * triggers the playlist loader to asynchronously switch to the
    * specified media playlist. Calling this method while the
    * loader is in the HAVE_NOTHING causes an error to be emitted
    * but otherwise has no effect.
    *
    * @param {Object=} playlist the parsed media playlist
    * object to switch to
    * @param {boolean=} shouldDelay whether we should delay the request by half target duration
    *
    * @return {Playlist} the current loaded media
    */
  ;

  _proto.media = function media(playlist, shouldDelay) {
    var _this4 = this;

    // getter
    if (!playlist) {
      return this.media_;
    } // setter


    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    } // find the playlist object if the target playlist has been
    // specified by URI


    if (typeof playlist === 'string') {
      if (!this.main.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }

      playlist = this.main.playlists[playlist];
    }

    window$1.clearTimeout(this.finalRenditionTimeout);

    if (shouldDelay) {
      var delay = (playlist.partTargetDuration || playlist.targetDuration) / 2 * 1000 || 5 * 1000;
      this.finalRenditionTimeout = window$1.setTimeout(this.media.bind(this, playlist, false), delay);
      return;
    }

    var startingState = this.state;
    var mediaChange = !this.media_ || playlist.id !== this.media_.id;
    var mainPlaylistRef = this.main.playlists[playlist.id]; // switch to fully loaded playlists immediately

    if (mainPlaylistRef && mainPlaylistRef.endList || // handle the case of a playlist object (e.g., if using vhs-json with a resolved
    // media playlist or, for the case of demuxed audio, a resolved audio media group)
    playlist.endList && playlist.segments.length) {
      // abort outstanding playlist requests
      if (this.request) {
        this.request.onreadystatechange = null;
        this.request.abort();
        this.request = null;
      }

      this.state = 'HAVE_METADATA';
      this.media_ = playlist; // trigger media change if the active media has been updated

      if (mediaChange) {
        this.trigger('mediachanging');

        if (startingState === 'HAVE_MAIN_MANIFEST') {
          // The initial playlist was a main manifest, and the first media selected was
          // also provided (in the form of a resolved playlist object) as part of the
          // source object (rather than just a URL). Therefore, since the media playlist
          // doesn't need to be requested, loadedmetadata won't trigger as part of the
          // normal flow, and needs an explicit trigger here.
          this.trigger('loadedmetadata');
        } else {
          this.trigger('mediachange');
        }
      }

      return;
    } // We update/set the timeout here so that live playlists
    // that are not a media change will "start" the loader as expected.
    // We expect that this function will start the media update timeout
    // cycle again. This also prevents a playlist switch failure from
    // causing us to stall during live.


    this.updateMediaUpdateTimeout_(refreshDelay(playlist, true)); // switching to the active playlist is a no-op

    if (!mediaChange) {
      return;
    }

    this.state = 'SWITCHING_MEDIA'; // there is already an outstanding playlist request

    if (this.request) {
      if (playlist.resolvedUri === this.request.url) {
        // requesting to switch to the same playlist multiple times
        // has no effect after the first
        return;
      }

      this.request.onreadystatechange = null;
      this.request.abort();
      this.request = null;
    } // request the new playlist


    if (this.media_) {
      this.trigger('mediachanging');
    }

    this.pendingMedia_ = playlist;
    this.request = this.vhs_.xhr({
      uri: playlist.resolvedUri,
      withCredentials: this.withCredentials,
      requestType: 'hls-playlist'
    }, function (error, req) {
      // disposed
      if (!_this4.request) {
        return;
      }

      playlist.lastRequest = Date.now();
      playlist.resolvedUri = resolveManifestRedirect(playlist.resolvedUri, req);

      if (error) {
        return _this4.playlistRequestError(_this4.request, playlist, startingState);
      }

      _this4.haveMetadata({
        playlistString: req.responseText,
        url: playlist.uri,
        id: playlist.id
      }); // fire loadedmetadata the first time a media playlist is loaded


      if (startingState === 'HAVE_MAIN_MANIFEST') {
        _this4.trigger('loadedmetadata');
      } else {
        _this4.trigger('mediachange');
      }
    });
  }
  /**
   * pause loading of the playlist
   */
  ;

  _proto.pause = function pause() {
    if (this.mediaUpdateTimeout) {
      window$1.clearTimeout(this.mediaUpdateTimeout);
      this.mediaUpdateTimeout = null;
    }

    this.stopRequest();

    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    } // Need to restore state now that no activity is happening


    if (this.state === 'SWITCHING_MEDIA') {
      // if the loader was in the process of switching media, it should either return to
      // HAVE_MAIN_MANIFEST or HAVE_METADATA depending on if the loader has loaded a media
      // playlist yet. This is determined by the existence of loader.media_
      if (this.media_) {
        this.state = 'HAVE_METADATA';
      } else {
        this.state = 'HAVE_MAIN_MANIFEST';
      }
    } else if (this.state === 'HAVE_CURRENT_METADATA') {
      this.state = 'HAVE_METADATA';
    }
  }
  /**
   * start loading of the playlist
   */
  ;

  _proto.load = function load(shouldDelay) {
    var _this5 = this;

    if (this.mediaUpdateTimeout) {
      window$1.clearTimeout(this.mediaUpdateTimeout);
      this.mediaUpdateTimeout = null;
    }

    var media = this.media();

    if (shouldDelay) {
      var delay = media ? (media.partTargetDuration || media.targetDuration) / 2 * 1000 : 5 * 1000;
      this.mediaUpdateTimeout = window$1.setTimeout(function () {
        _this5.mediaUpdateTimeout = null;

        _this5.load();
      }, delay);
      return;
    }

    if (!this.started) {
      this.start();
      return;
    }

    if (media && !media.endList) {
      this.trigger('mediaupdatetimeout');
    } else {
      this.trigger('loadedplaylist');
    }
  };

  _proto.updateMediaUpdateTimeout_ = function updateMediaUpdateTimeout_(delay) {
    var _this6 = this;

    if (this.mediaUpdateTimeout) {
      window$1.clearTimeout(this.mediaUpdateTimeout);
      this.mediaUpdateTimeout = null;
    } // we only have use mediaupdatetimeout for live playlists.


    if (!this.media() || this.media().endList) {
      return;
    }

    this.mediaUpdateTimeout = window$1.setTimeout(function () {
      _this6.mediaUpdateTimeout = null;

      _this6.trigger('mediaupdatetimeout');

      _this6.updateMediaUpdateTimeout_(delay);
    }, delay);
  }
  /**
   * start loading of the playlist
   */
  ;

  _proto.start = function start() {
    var _this7 = this;

    this.started = true;

    if (typeof this.src === 'object') {
      // in the case of an entirely constructed manifest object (meaning there's no actual
      // manifest on a server), default the uri to the page's href
      if (!this.src.uri) {
        this.src.uri = window$1.location.href;
      } // resolvedUri is added on internally after the initial request. Since there's no
      // request for pre-resolved manifests, add on resolvedUri here.


      this.src.resolvedUri = this.src.uri; // Since a manifest object was passed in as the source (instead of a URL), the first
      // request can be skipped (since the top level of the manifest, at a minimum, is
      // already available as a parsed manifest object). However, if the manifest object
      // represents a main playlist, some media playlists may need to be resolved before
      // the starting segment list is available. Therefore, go directly to setup of the
      // initial playlist, and let the normal flow continue from there.
      //
      // Note that the call to setup is asynchronous, as other sections of VHS may assume
      // that the first request is asynchronous.

      setTimeout(function () {
        _this7.setupInitialPlaylist(_this7.src);
      }, 0);
      return;
    } // request the specified URL


    this.request = this.vhs_.xhr({
      uri: this.src,
      withCredentials: this.withCredentials,
      requestType: 'hls-playlist'
    }, function (error, req) {
      // disposed
      if (!_this7.request) {
        return;
      } // clear the loader's request reference


      _this7.request = null;

      if (error) {
        _this7.error = {
          status: req.status,
          message: "HLS playlist request error at URL: " + _this7.src + ".",
          responseText: req.responseText,
          // MEDIA_ERR_NETWORK
          code: 2,
          metadata: {
            errorType: videojs.Error.HlsPlaylistRequestError
          }
        };

        if (_this7.state === 'HAVE_NOTHING') {
          _this7.started = false;
        }

        return _this7.trigger('error');
      }

      _this7.src = resolveManifestRedirect(_this7.src, req);

      var manifest = _this7.parseManifest_({
        manifestString: req.responseText,
        url: _this7.src
      });

      _this7.setupInitialPlaylist(manifest);
    });
  };

  _proto.srcUri = function srcUri() {
    return typeof this.src === 'string' ? this.src : this.src.uri;
  }
  /**
   * Given a manifest object that's either a main or media playlist, trigger the proper
   * events and set the state of the playlist loader.
   *
   * If the manifest object represents a main playlist, `loadedplaylist` will be
   * triggered to allow listeners to select a playlist. If none is selected, the loader
   * will default to the first one in the playlists array.
   *
   * If the manifest object represents a media playlist, `loadedplaylist` will be
   * triggered followed by `loadedmetadata`, as the only available playlist is loaded.
   *
   * In the case of a media playlist, a main playlist object wrapper with one playlist
   * will be created so that all logic can handle playlists in the same fashion (as an
   * assumed manifest object schema).
   *
   * @param {Object} manifest
   *        The parsed manifest object
   */
  ;

  _proto.setupInitialPlaylist = function setupInitialPlaylist(manifest) {
    this.state = 'HAVE_MAIN_MANIFEST';

    if (manifest.playlists) {
      this.main = manifest;
      addPropertiesToMain(this.main, this.srcUri()); // If the initial main playlist has playlists wtih segments already resolved,
      // then resolve URIs in advance, as they are usually done after a playlist request,
      // which may not happen if the playlist is resolved.

      manifest.playlists.forEach(function (playlist) {
        playlist.segments = getAllSegments(playlist);
        playlist.segments.forEach(function (segment) {
          resolveSegmentUris(segment, playlist.resolvedUri);
        });
      });
      this.trigger('loadedplaylist');

      if (!this.request) {
        // no media playlist was specifically selected so start
        // from the first listed one
        this.media(this.main.playlists[0]);
      }

      return;
    } // In order to support media playlists passed in as vhs-json, the case where the uri
    // is not provided as part of the manifest should be considered, and an appropriate
    // default used.


    var uri = this.srcUri() || window$1.location.href;
    this.main = mainForMedia(manifest, uri);
    this.haveMetadata({
      playlistObject: manifest,
      url: uri,
      id: this.main.playlists[0].id
    });
    this.trigger('loadedmetadata');
  }
  /**
   * Updates or deletes a preexisting pathway clone.
   * Ensures that all playlists related to the old pathway clone are
   * either updated or deleted.
   *
   * @param {Object} clone On update, the pathway clone object for the newly updated pathway clone.
   *        On delete, the old pathway clone object to be deleted.
   * @param {boolean} isUpdate True if the pathway is to be updated,
   *        false if it is meant to be deleted.
   */
  ;

  _proto.updateOrDeleteClone = function updateOrDeleteClone(clone, isUpdate) {
    var main = this.main;
    var pathway = clone.ID;
    var i = main.playlists.length; // Iterate backwards through the playlist so we can remove playlists if necessary.

    while (i--) {
      var p = main.playlists[i];

      if (p.attributes['PATHWAY-ID'] === pathway) {
        var oldPlaylistUri = p.resolvedUri;
        var oldPlaylistId = p.id; // update the indexed playlist and add new playlists by ID and URI

        if (isUpdate) {
          var newPlaylistUri = this.createCloneURI_(p.resolvedUri, clone);
          var newPlaylistId = createPlaylistID(pathway, newPlaylistUri);
          var attributes = this.createCloneAttributes_(pathway, p.attributes);
          var updatedPlaylist = this.createClonePlaylist_(p, newPlaylistId, clone, attributes);
          main.playlists[i] = updatedPlaylist;
          main.playlists[newPlaylistId] = updatedPlaylist;
          main.playlists[newPlaylistUri] = updatedPlaylist;
        } else {
          // Remove the indexed playlist.
          main.playlists.splice(i, 1);
        } // Remove playlists by the old ID and URI.


        delete main.playlists[oldPlaylistId];
        delete main.playlists[oldPlaylistUri];
      }
    }

    this.updateOrDeleteCloneMedia(clone, isUpdate);
  }
  /**
   * Updates or deletes media data based on the pathway clone object.
   * Due to the complexity of the media groups and playlists, in all cases
   * we remove all of the old media groups and playlists.
   * On updates, we then create new media groups and playlists based on the
   * new pathway clone object.
   *
   * @param {Object} clone The pathway clone object for the newly updated pathway clone.
   * @param {boolean} isUpdate True if the pathway is to be updated,
   *        false if it is meant to be deleted.
   */
  ;

  _proto.updateOrDeleteCloneMedia = function updateOrDeleteCloneMedia(clone, isUpdate) {
    var main = this.main;
    var id = clone.ID;
    ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (mediaType) {
      if (!main.mediaGroups[mediaType] || !main.mediaGroups[mediaType][id]) {
        return;
      }

      for (var groupKey in main.mediaGroups[mediaType]) {
        // Remove all media playlists for the media group for this pathway clone.
        if (groupKey === id) {
          for (var labelKey in main.mediaGroups[mediaType][groupKey]) {
            var oldMedia = main.mediaGroups[mediaType][groupKey][labelKey];
            oldMedia.playlists.forEach(function (p, i) {
              var oldMediaPlaylist = main.playlists[p.id];
              var oldPlaylistId = oldMediaPlaylist.id;
              var oldPlaylistUri = oldMediaPlaylist.resolvedUri;
              delete main.playlists[oldPlaylistId];
              delete main.playlists[oldPlaylistUri];
            });
          } // Delete the old media group.


          delete main.mediaGroups[mediaType][groupKey];
        }
      }
    }); // Create the new media groups and playlists if there is an update.

    if (isUpdate) {
      this.createClonedMediaGroups_(clone);
    }
  }
  /**
   * Given a pathway clone object, clones all necessary playlists.
   *
   * @param {Object} clone The pathway clone object.
   * @param {Object} basePlaylist The original playlist to clone from.
   */
  ;

  _proto.addClonePathway = function addClonePathway(clone, basePlaylist) {
    if (basePlaylist === void 0) {
      basePlaylist = {};
    }

    var main = this.main;
    var index = main.playlists.length;
    var uri = this.createCloneURI_(basePlaylist.resolvedUri, clone);
    var playlistId = createPlaylistID(clone.ID, uri);
    var attributes = this.createCloneAttributes_(clone.ID, basePlaylist.attributes);
    var playlist = this.createClonePlaylist_(basePlaylist, playlistId, clone, attributes);
    main.playlists[index] = playlist; // add playlist by ID and URI

    main.playlists[playlistId] = playlist;
    main.playlists[uri] = playlist;
    this.createClonedMediaGroups_(clone);
  }
  /**
   * Given a pathway clone object we create clones of all media.
   * In this function, all necessary information and updated playlists
   * are added to the `mediaGroup` object.
   * Playlists are also added to the `playlists` array so the media groups
   * will be properly linked.
   *
   * @param {Object} clone The pathway clone object.
   */
  ;

  _proto.createClonedMediaGroups_ = function createClonedMediaGroups_(clone) {
    var _this8 = this;

    var id = clone.ID;
    var baseID = clone['BASE-ID'];
    var main = this.main;
    ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (mediaType) {
      // If the media type doesn't exist, or there is already a clone, skip
      // to the next media type.
      if (!main.mediaGroups[mediaType] || main.mediaGroups[mediaType][id]) {
        return;
      }

      for (var groupKey in main.mediaGroups[mediaType]) {
        if (groupKey === baseID) {
          // Create the group.
          main.mediaGroups[mediaType][id] = {};
        } else {
          // There is no need to iterate over label keys in this case.
          continue;
        }

        var _loop = function _loop(labelKey) {
          var oldMedia = main.mediaGroups[mediaType][groupKey][labelKey];
          main.mediaGroups[mediaType][id][labelKey] = _extends({}, oldMedia);
          var newMedia = main.mediaGroups[mediaType][id][labelKey]; // update URIs on the media

          var newUri = _this8.createCloneURI_(oldMedia.resolvedUri, clone);

          newMedia.resolvedUri = newUri;
          newMedia.uri = newUri; // Reset playlists in the new media group.

          newMedia.playlists = []; // Create new playlists in the newly cloned media group.

          oldMedia.playlists.forEach(function (p, i) {
            var oldMediaPlaylist = main.playlists[p.id];
            var group = groupID(mediaType, id, labelKey);
            var newPlaylistID = createPlaylistID(id, group); // Check to see if it already exists

            if (oldMediaPlaylist && !main.playlists[newPlaylistID]) {
              var newMediaPlaylist = _this8.createClonePlaylist_(oldMediaPlaylist, newPlaylistID, clone);

              var newPlaylistUri = newMediaPlaylist.resolvedUri;
              main.playlists[newPlaylistID] = newMediaPlaylist;
              main.playlists[newPlaylistUri] = newMediaPlaylist;
            }

            newMedia.playlists[i] = _this8.createClonePlaylist_(p, newPlaylistID, clone);
          });
        };

        for (var labelKey in main.mediaGroups[mediaType][groupKey]) {
          _loop(labelKey);
        }
      }
    });
  }
  /**
   * Using the original playlist to be cloned, and the pathway clone object
   * information, we create a new playlist.
   *
   * @param {Object} basePlaylist  The original playlist to be cloned from.
   * @param {string} id The desired id of the newly cloned playlist.
   * @param {Object} clone The pathway clone object.
   * @param {Object} attributes An optional object to populate the `attributes` property in the playlist.
   *
   * @return {Object} The combined cloned playlist.
   */
  ;

  _proto.createClonePlaylist_ = function createClonePlaylist_(basePlaylist, id, clone, attributes) {
    var uri = this.createCloneURI_(basePlaylist.resolvedUri, clone);
    var newProps = {
      resolvedUri: uri,
      uri: uri,
      id: id
    }; // Remove all segments from previous playlist in the clone.

    if (basePlaylist.segments) {
      newProps.segments = [];
    }

    if (attributes) {
      newProps.attributes = attributes;
    }

    return merge(basePlaylist, newProps);
  }
  /**
   * Generates an updated URI for a cloned pathway based on the original
   * pathway's URI and the paramaters from the pathway clone object in the
   * content steering server response.
   *
   * @param {string} baseUri URI to be updated in the cloned pathway.
   * @param {Object} clone The pathway clone object.
   *
   * @return {string} The updated URI for the cloned pathway.
   */
  ;

  _proto.createCloneURI_ = function createCloneURI_(baseURI, clone) {
    var uri = new URL(baseURI);
    uri.hostname = clone['URI-REPLACEMENT'].HOST;
    var params = clone['URI-REPLACEMENT'].PARAMS; // Add params to the cloned URL.

    for (var _i3 = 0, _Object$keys = Object.keys(params); _i3 < _Object$keys.length; _i3++) {
      var key = _Object$keys[_i3];
      uri.searchParams.set(key, params[key]);
    }

    return uri.href;
  }
  /**
   * Helper function to create the attributes needed for the new clone.
   * This mainly adds the necessary media attributes.
   *
   * @param {string} id The pathway clone object ID.
   * @param {Object} oldAttributes The old attributes to compare to.
   * @return {Object} The new attributes to add to the playlist.
   */
  ;

  _proto.createCloneAttributes_ = function createCloneAttributes_(id, oldAttributes) {
    var _attributes;

    var attributes = (_attributes = {}, _attributes['PATHWAY-ID'] = id, _attributes);
    ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (mediaType) {
      if (oldAttributes[mediaType]) {
        attributes[mediaType] = id;
      }
    });
    return attributes;
  }
  /**
   * Returns the key ID set from a playlist
   *
   * @param {playlist} playlist to fetch the key ID set from.
   * @return a Set of 32 digit hex strings that represent the unique keyIds for that playlist.
   */
  ;

  _proto.getKeyIdSet = function getKeyIdSet(playlist) {
    if (playlist.contentProtection) {
      var keyIds = new Set();

      for (var keysystem in playlist.contentProtection) {
        var keyId = playlist.contentProtection[keysystem].attributes.keyId;

        if (keyId) {
          keyIds.add(keyId.toLowerCase());
        }
      }

      return keyIds;
    }
  };

  return PlaylistLoader;
}(EventTarget$1);

/**
 * @file xhr.js
 */

var callbackWrapper = function callbackWrapper(request, error, response, callback) {
  var reqResponse = request.responseType === 'arraybuffer' ? request.response : request.responseText;

  if (!error && reqResponse) {
    request.responseTime = Date.now();
    request.roundTripTime = request.responseTime - request.requestTime;
    request.bytesReceived = reqResponse.byteLength || reqResponse.length;

    if (!request.bandwidth) {
      request.bandwidth = Math.floor(request.bytesReceived / request.roundTripTime * 8 * 1000);
    }
  }

  if (response.headers) {
    request.responseHeaders = response.headers;
  } // videojs.xhr now uses a specific code on the error
  // object to signal that a request has timed out instead
  // of setting a boolean on the request object


  if (error && error.code === 'ETIMEDOUT') {
    request.timedout = true;
  } // videojs.xhr no longer considers status codes outside of 200 and 0
  // (for file uris) to be errors, but the old XHR did, so emulate that
  // behavior. Status 206 may be used in response to byterange requests.


  if (!error && !request.aborted && response.statusCode !== 200 && response.statusCode !== 206 && response.statusCode !== 0) {
    error = new Error('XHR Failed with a response of: ' + (request && (reqResponse || request.responseText)));
  }

  callback(error, request);
};
/**
 * Iterates over the request hooks Set and calls them in order
 *
 * @param {Set} hooks the hook Set to iterate over
 * @param {Object} options the request options to pass to the xhr wrapper
 * @return the callback hook function return value, the modified or new options Object.
 */


var callAllRequestHooks = function callAllRequestHooks(requestSet, options) {
  if (!requestSet || !requestSet.size) {
    return;
  }

  var newOptions = options;
  requestSet.forEach(function (requestCallback) {
    newOptions = requestCallback(newOptions);
  });
  return newOptions;
};
/**
 * Iterates over the response hooks Set and calls them in order.
 *
 * @param {Set} hooks the hook Set to iterate over
 * @param {Object} request the xhr request object
 * @param {Object} error the xhr error object
 * @param {Object} response the xhr response object
 */


var callAllResponseHooks = function callAllResponseHooks(responseSet, request, error, response) {
  if (!responseSet || !responseSet.size) {
    return;
  }

  responseSet.forEach(function (responseCallback) {
    responseCallback(request, error, response);
  });
};

var xhrFactory = function xhrFactory() {
  var xhr = function XhrFunction(options, callback) {
    // Add a default timeout
    options = merge({
      timeout: 45e3
    }, options); // Allow an optional user-specified function to modify the option
    // object before we construct the xhr request
    // TODO: Remove beforeRequest in the next major release.

    var beforeRequest = XhrFunction.beforeRequest || videojs.Vhs.xhr.beforeRequest; // onRequest and onResponse hooks as a Set, at either the player or global level.
    // TODO: new Set added here for beforeRequest alias. Remove this when beforeRequest is removed.

    var _requestCallbackSet = XhrFunction._requestCallbackSet || videojs.Vhs.xhr._requestCallbackSet || new Set();

    var _responseCallbackSet = XhrFunction._responseCallbackSet || videojs.Vhs.xhr._responseCallbackSet;

    if (beforeRequest && typeof beforeRequest === 'function') {
      videojs.log.warn('beforeRequest is deprecated, use onRequest instead.');

      _requestCallbackSet.add(beforeRequest);
    } // Use the standard videojs.xhr() method unless `videojs.Vhs.xhr` has been overriden
    // TODO: switch back to videojs.Vhs.xhr.name === 'XhrFunction' when we drop IE11


    var xhrMethod = videojs.Vhs.xhr.original === true ? videojs.xhr : videojs.Vhs.xhr; // call all registered onRequest hooks, assign new options.

    var beforeRequestOptions = callAllRequestHooks(_requestCallbackSet, options); // Remove the beforeRequest function from the hooks set so stale beforeRequest functions are not called.

    _requestCallbackSet.delete(beforeRequest); // xhrMethod will call XMLHttpRequest.open and XMLHttpRequest.send


    var request = xhrMethod(beforeRequestOptions || options, function (error, response) {
      // call all registered onResponse hooks
      callAllResponseHooks(_responseCallbackSet, request, error, response);
      return callbackWrapper(request, error, response, callback);
    });
    var originalAbort = request.abort;

    request.abort = function () {
      request.aborted = true;
      return originalAbort.apply(request, arguments);
    };

    request.uri = options.uri;
    request.requestTime = Date.now();
    return request;
  };

  xhr.original = true;
  return xhr;
};
/**
 * Turns segment byterange into a string suitable for use in
 * HTTP Range requests
 *
 * @param {Object} byterange - an object with two values defining the start and end
 *                             of a byte-range
 */


var byterangeStr = function byterangeStr(byterange) {
  // `byterangeEnd` is one less than `offset + length` because the HTTP range
  // header uses inclusive ranges
  var byterangeEnd;
  var byterangeStart = byterange.offset;

  if (typeof byterange.offset === 'bigint' || typeof byterange.length === 'bigint') {
    byterangeEnd = window$1.BigInt(byterange.offset) + window$1.BigInt(byterange.length) - window$1.BigInt(1);
  } else {
    byterangeEnd = byterange.offset + byterange.length - 1;
  }

  return 'bytes=' + byterangeStart + '-' + byterangeEnd;
};
/**
 * Defines headers for use in the xhr request for a particular segment.
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 */

var segmentXhrHeaders = function segmentXhrHeaders(segment) {
  var headers = {};

  if (segment.byterange) {
    headers.Range = byterangeStr(segment.byterange);
  }

  return headers;
};

/**
 * @file bin-utils.js
 */

/**
 * convert a TimeRange to text
 *
 * @param {TimeRange} range the timerange to use for conversion
 * @param {number} i the iterator on the range to convert
 * @return {string} the range in string format
 */

var textRange = function textRange(range, i) {
  return range.start(i) + '-' + range.end(i);
};
/**
 * format a number as hex string
 *
 * @param {number} e The number
 * @param {number} i the iterator
 * @return {string} the hex formatted number as a string
 */


var formatHexString = function formatHexString(e, i) {
  var value = e.toString(16);
  return '00'.substring(0, 2 - value.length) + value + (i % 2 ? ' ' : '');
};

var formatAsciiString = function formatAsciiString(e) {
  if (e >= 0x20 && e < 0x7e) {
    return String.fromCharCode(e);
  }

  return '.';
};
/**
 * Creates an object for sending to a web worker modifying properties that are TypedArrays
 * into a new object with seperated properties for the buffer, byteOffset, and byteLength.
 *
 * @param {Object} message
 *        Object of properties and values to send to the web worker
 * @return {Object}
 *         Modified message with TypedArray values expanded
 * @function createTransferableMessage
 */


var createTransferableMessage = function createTransferableMessage(message) {
  var transferable = {};
  Object.keys(message).forEach(function (key) {
    var value = message[key];

    if (isArrayBufferView(value)) {
      transferable[key] = {
        bytes: value.buffer,
        byteOffset: value.byteOffset,
        byteLength: value.byteLength
      };
    } else {
      transferable[key] = value;
    }
  });
  return transferable;
};
/**
 * Returns a unique string identifier for a media initialization
 * segment.
 *
 * @param {Object} initSegment
 *        the init segment object.
 *
 * @return {string} the generated init segment id
 */

var initSegmentId = function initSegmentId(initSegment) {
  var byterange = initSegment.byterange || {
    length: Infinity,
    offset: 0
  };
  return [byterange.length, byterange.offset, initSegment.resolvedUri].join(',');
};
/**
 * Returns a unique string identifier for a media segment key.
 *
 * @param {Object} key the encryption key
 * @return {string} the unique id for the media segment key.
 */

var segmentKeyId = function segmentKeyId(key) {
  return key.resolvedUri;
};
/**
 * utils to help dump binary data to the console
 *
 * @param {Array|TypedArray} data
 *        data to dump to a string
 *
 * @return {string} the data as a hex string.
 */

var hexDump = function hexDump(data) {
  var bytes = Array.prototype.slice.call(data);
  var step = 16;
  var result = '';
  var hex;
  var ascii;

  for (var j = 0; j < bytes.length / step; j++) {
    hex = bytes.slice(j * step, j * step + step).map(formatHexString).join('');
    ascii = bytes.slice(j * step, j * step + step).map(formatAsciiString).join('');
    result += hex + ' ' + ascii + '\n';
  }

  return result;
};
var tagDump = function tagDump(_ref) {
  var bytes = _ref.bytes;
  return hexDump(bytes);
};
var textRanges = function textRanges(ranges) {
  var result = '';
  var i;

  for (i = 0; i < ranges.length; i++) {
    result += textRange(ranges, i) + ' ';
  }

  return result;
};

var utils = /*#__PURE__*/Object.freeze({
  __proto__: null,
  createTransferableMessage: createTransferableMessage,
  initSegmentId: initSegmentId,
  segmentKeyId: segmentKeyId,
  hexDump: hexDump,
  tagDump: tagDump,
  textRanges: textRanges
});

// TODO handle fmp4 case where the timing info is accurate and doesn't involve transmux
// 25% was arbitrarily chosen, and may need to be refined over time.

var SEGMENT_END_FUDGE_PERCENT = 0.25;
/**
 * Converts a player time (any time that can be gotten/set from player.currentTime(),
 * e.g., any time within player.seekable().start(0) to player.seekable().end(0)) to a
 * program time (any time referencing the real world (e.g., EXT-X-PROGRAM-DATE-TIME)).
 *
 * The containing segment is required as the EXT-X-PROGRAM-DATE-TIME serves as an "anchor
 * point" (a point where we have a mapping from program time to player time, with player
 * time being the post transmux start of the segment).
 *
 * For more details, see [this doc](../../docs/program-time-from-player-time.md).
 *
 * @param {number} playerTime the player time
 * @param {Object} segment the segment which contains the player time
 * @return {Date} program time
 */

var playerTimeToProgramTime = function playerTimeToProgramTime(playerTime, segment) {
  if (!segment.dateTimeObject) {
    // Can't convert without an "anchor point" for the program time (i.e., a time that can
    // be used to map the start of a segment with a real world time).
    return null;
  }

  var transmuxerPrependedSeconds = segment.videoTimingInfo.transmuxerPrependedSeconds;
  var transmuxedStart = segment.videoTimingInfo.transmuxedPresentationStart; // get the start of the content from before old content is prepended

  var startOfSegment = transmuxedStart + transmuxerPrependedSeconds;
  var offsetFromSegmentStart = playerTime - startOfSegment;
  return new Date(segment.dateTimeObject.getTime() + offsetFromSegmentStart * 1000);
};
var originalSegmentVideoDuration = function originalSegmentVideoDuration(videoTimingInfo) {
  return videoTimingInfo.transmuxedPresentationEnd - videoTimingInfo.transmuxedPresentationStart - videoTimingInfo.transmuxerPrependedSeconds;
};
/**
 * Finds a segment that contains the time requested given as an ISO-8601 string. The
 * returned segment might be an estimate or an accurate match.
 *
 * @param {string} programTime The ISO-8601 programTime to find a match for
 * @param {Object} playlist A playlist object to search within
 */

var findSegmentForProgramTime = function findSegmentForProgramTime(programTime, playlist) {
  // Assumptions:
  //  - verifyProgramDateTimeTags has already been run
  //  - live streams have been started
  var dateTimeObject;

  try {
    dateTimeObject = new Date(programTime);
  } catch (e) {
    return null;
  }

  if (!playlist || !playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  var segment = playlist.segments[0];

  if (dateTimeObject < new Date(segment.dateTimeObject)) {
    // Requested time is before stream start.
    return null;
  }

  for (var i = 0; i < playlist.segments.length - 1; i++) {
    segment = playlist.segments[i];
    var nextSegmentStart = new Date(playlist.segments[i + 1].dateTimeObject);

    if (dateTimeObject < nextSegmentStart) {
      break;
    }
  }

  var lastSegment = playlist.segments[playlist.segments.length - 1];
  var lastSegmentStart = lastSegment.dateTimeObject;
  var lastSegmentDuration = lastSegment.videoTimingInfo ? originalSegmentVideoDuration(lastSegment.videoTimingInfo) : lastSegment.duration + lastSegment.duration * SEGMENT_END_FUDGE_PERCENT;
  var lastSegmentEnd = new Date(lastSegmentStart.getTime() + lastSegmentDuration * 1000);

  if (dateTimeObject > lastSegmentEnd) {
    // Beyond the end of the stream, or our best guess of the end of the stream.
    return null;
  }

  if (dateTimeObject > new Date(lastSegmentStart)) {
    segment = lastSegment;
  }

  return {
    segment: segment,
    estimatedStart: segment.videoTimingInfo ? segment.videoTimingInfo.transmuxedPresentationStart : Playlist.duration(playlist, playlist.mediaSequence + playlist.segments.indexOf(segment)),
    // Although, given that all segments have accurate date time objects, the segment
    // selected should be accurate, unless the video has been transmuxed at some point
    // (determined by the presence of the videoTimingInfo object), the segment's "player
    // time" (the start time in the player) can't be considered accurate.
    type: segment.videoTimingInfo ? 'accurate' : 'estimate'
  };
};
/**
 * Finds a segment that contains the given player time(in seconds).
 *
 * @param {number} time The player time to find a match for
 * @param {Object} playlist A playlist object to search within
 */

var findSegmentForPlayerTime = function findSegmentForPlayerTime(time, playlist) {
  // Assumptions:
  // - there will always be a segment.duration
  // - we can start from zero
  // - segments are in time order
  if (!playlist || !playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  var segmentEnd = 0;
  var segment;

  for (var i = 0; i < playlist.segments.length; i++) {
    segment = playlist.segments[i]; // videoTimingInfo is set after the segment is downloaded and transmuxed, and
    // should contain the most accurate values we have for the segment's player times.
    //
    // Use the accurate transmuxedPresentationEnd value if it is available, otherwise fall
    // back to an estimate based on the manifest derived (inaccurate) segment.duration, to
    // calculate an end value.

    segmentEnd = segment.videoTimingInfo ? segment.videoTimingInfo.transmuxedPresentationEnd : segmentEnd + segment.duration;

    if (time <= segmentEnd) {
      break;
    }
  }

  var lastSegment = playlist.segments[playlist.segments.length - 1];

  if (lastSegment.videoTimingInfo && lastSegment.videoTimingInfo.transmuxedPresentationEnd < time) {
    // The time requested is beyond the stream end.
    return null;
  }

  if (time > segmentEnd) {
    // The time is within or beyond the last segment.
    //
    // Check to see if the time is beyond a reasonable guess of the end of the stream.
    if (time > segmentEnd + lastSegment.duration * SEGMENT_END_FUDGE_PERCENT) {
      // Technically, because the duration value is only an estimate, the time may still
      // exist in the last segment, however, there isn't enough information to make even
      // a reasonable estimate.
      return null;
    }

    segment = lastSegment;
  }

  return {
    segment: segment,
    estimatedStart: segment.videoTimingInfo ? segment.videoTimingInfo.transmuxedPresentationStart : segmentEnd - segment.duration,
    // Because videoTimingInfo is only set after transmux, it is the only way to get
    // accurate timing values.
    type: segment.videoTimingInfo ? 'accurate' : 'estimate'
  };
};
/**
 * Gives the offset of the comparisonTimestamp from the programTime timestamp in seconds.
 * If the offset returned is positive, the programTime occurs after the
 * comparisonTimestamp.
 * If the offset is negative, the programTime occurs before the comparisonTimestamp.
 *
 * @param {string} comparisonTimeStamp An ISO-8601 timestamp to compare against
 * @param {string} programTime The programTime as an ISO-8601 string
 * @return {number} offset
 */

var getOffsetFromTimestamp = function getOffsetFromTimestamp(comparisonTimeStamp, programTime) {
  var segmentDateTime;
  var programDateTime;

  try {
    segmentDateTime = new Date(comparisonTimeStamp);
    programDateTime = new Date(programTime);
  } catch (e) {// TODO handle error
  }

  var segmentTimeEpoch = segmentDateTime.getTime();
  var programTimeEpoch = programDateTime.getTime();
  return (programTimeEpoch - segmentTimeEpoch) / 1000;
};
/**
 * Checks that all segments in this playlist have programDateTime tags.
 *
 * @param {Object} playlist A playlist object
 */

var verifyProgramDateTimeTags = function verifyProgramDateTimeTags(playlist) {
  if (!playlist.segments || playlist.segments.length === 0) {
    return false;
  }

  for (var i = 0; i < playlist.segments.length; i++) {
    var segment = playlist.segments[i];

    if (!segment.dateTimeObject) {
      return false;
    }
  }

  return true;
};
/**
 * Returns the programTime of the media given a playlist and a playerTime.
 * The playlist must have programDateTime tags for a programDateTime tag to be returned.
 * If the segments containing the time requested have not been buffered yet, an estimate
 * may be returned to the callback.
 *
 * @param {Object} args
 * @param {Object} args.playlist A playlist object to search within
 * @param {number} time A playerTime in seconds
 * @param {Function} callback(err, programTime)
 * @return {string} err.message A detailed error message
 * @return {Object} programTime
 * @return {number} programTime.mediaSeconds The streamTime in seconds
 * @return {string} programTime.programDateTime The programTime as an ISO-8601 String
 */

var getProgramTime = function getProgramTime(_ref) {
  var playlist = _ref.playlist,
      _ref$time = _ref.time,
      time = _ref$time === void 0 ? undefined : _ref$time,
      callback = _ref.callback;

  if (!callback) {
    throw new Error('getProgramTime: callback must be provided');
  }

  if (!playlist || time === undefined) {
    return callback({
      message: 'getProgramTime: playlist and time must be provided'
    });
  }

  var matchedSegment = findSegmentForPlayerTime(time, playlist);

  if (!matchedSegment) {
    return callback({
      message: 'valid programTime was not found'
    });
  }

  if (matchedSegment.type === 'estimate') {
    return callback({
      message: 'Accurate programTime could not be determined.' + ' Please seek to e.seekTime and try again',
      seekTime: matchedSegment.estimatedStart
    });
  }

  var programTimeObject = {
    mediaSeconds: time
  };
  var programTime = playerTimeToProgramTime(time, matchedSegment.segment);

  if (programTime) {
    programTimeObject.programDateTime = programTime.toISOString();
  }

  return callback(null, programTimeObject);
};
/**
 * Seeks in the player to a time that matches the given programTime ISO-8601 string.
 *
 * @param {Object} args
 * @param {string} args.programTime A programTime to seek to as an ISO-8601 String
 * @param {Object} args.playlist A playlist to look within
 * @param {number} args.retryCount The number of times to try for an accurate seek. Default is 2.
 * @param {Function} args.seekTo A method to perform a seek
 * @param {boolean} args.pauseAfterSeek Whether to end in a paused state after seeking. Default is true.
 * @param {Object} args.tech The tech to seek on
 * @param {Function} args.callback(err, newTime) A callback to return the new time to
 * @return {string} err.message A detailed error message
 * @return {number} newTime The exact time that was seeked to in seconds
 */

var seekToProgramTime = function seekToProgramTime(_ref2) {
  var programTime = _ref2.programTime,
      playlist = _ref2.playlist,
      _ref2$retryCount = _ref2.retryCount,
      retryCount = _ref2$retryCount === void 0 ? 2 : _ref2$retryCount,
      seekTo = _ref2.seekTo,
      _ref2$pauseAfterSeek = _ref2.pauseAfterSeek,
      pauseAfterSeek = _ref2$pauseAfterSeek === void 0 ? true : _ref2$pauseAfterSeek,
      tech = _ref2.tech,
      callback = _ref2.callback;

  if (!callback) {
    throw new Error('seekToProgramTime: callback must be provided');
  }

  if (typeof programTime === 'undefined' || !playlist || !seekTo) {
    return callback({
      message: 'seekToProgramTime: programTime, seekTo and playlist must be provided'
    });
  }

  if (!playlist.endList && !tech.hasStarted_) {
    return callback({
      message: 'player must be playing a live stream to start buffering'
    });
  }

  if (!verifyProgramDateTimeTags(playlist)) {
    return callback({
      message: 'programDateTime tags must be provided in the manifest ' + playlist.resolvedUri
    });
  }

  var matchedSegment = findSegmentForProgramTime(programTime, playlist); // no match

  if (!matchedSegment) {
    return callback({
      message: programTime + " was not found in the stream"
    });
  }

  var segment = matchedSegment.segment;
  var mediaOffset = getOffsetFromTimestamp(segment.dateTimeObject, programTime);

  if (matchedSegment.type === 'estimate') {
    // we've run out of retries
    if (retryCount === 0) {
      return callback({
        message: programTime + " is not buffered yet. Try again"
      });
    }

    seekTo(matchedSegment.estimatedStart + mediaOffset);
    tech.one('seeked', function () {
      seekToProgramTime({
        programTime: programTime,
        playlist: playlist,
        retryCount: retryCount - 1,
        seekTo: seekTo,
        pauseAfterSeek: pauseAfterSeek,
        tech: tech,
        callback: callback
      });
    });
    return;
  } // Since the segment.start value is determined from the buffered end or ending time
  // of the prior segment, the seekToTime doesn't need to account for any transmuxer
  // modifications.


  var seekToTime = segment.start + mediaOffset;

  var seekedCallback = function seekedCallback() {
    return callback(null, tech.currentTime());
  }; // listen for seeked event


  tech.one('seeked', seekedCallback); // pause before seeking as video.js will restore this state

  if (pauseAfterSeek) {
    tech.pause();
  }

  seekTo(seekToTime);
};

// which will only happen if the request is complete.

var callbackOnCompleted = function callbackOnCompleted(request, cb) {
  if (request.readyState === 4) {
    return cb();
  }

  return;
};

var containerRequest = function containerRequest(uri, xhr, cb) {
  var bytes = [];
  var id3Offset;
  var finished = false;

  var endRequestAndCallback = function endRequestAndCallback(err, req, type, _bytes) {
    req.abort();
    finished = true;
    return cb(err, req, type, _bytes);
  };

  var progressListener = function progressListener(error, request) {
    if (finished) {
      return;
    }

    if (error) {
      return endRequestAndCallback(error, request, '', bytes);
    } // grap the new part of content that was just downloaded


    var newPart = request.responseText.substring(bytes && bytes.byteLength || 0, request.responseText.length); // add that onto bytes

    bytes = concatTypedArrays(bytes, stringToBytes(newPart, true));
    id3Offset = id3Offset || getId3Offset(bytes); // we need at least 10 bytes to determine a type
    // or we need at least two bytes after an id3Offset

    if (bytes.length < 10 || id3Offset && bytes.length < id3Offset + 2) {
      return callbackOnCompleted(request, function () {
        return endRequestAndCallback(error, request, '', bytes);
      });
    }

    var type = detectContainerForBytes(bytes); // if this looks like a ts segment but we don't have enough data
    // to see the second sync byte, wait until we have enough data
    // before declaring it ts

    if (type === 'ts' && bytes.length < 188) {
      return callbackOnCompleted(request, function () {
        return endRequestAndCallback(error, request, '', bytes);
      });
    } // this may be an unsynced ts segment
    // wait for 376 bytes before detecting no container


    if (!type && bytes.length < 376) {
      return callbackOnCompleted(request, function () {
        return endRequestAndCallback(error, request, '', bytes);
      });
    }

    return endRequestAndCallback(null, request, type, bytes);
  };

  var options = {
    uri: uri,
    beforeSend: function beforeSend(request) {
      // this forces the browser to pass the bytes to us unprocessed
      request.overrideMimeType('text/plain; charset=x-user-defined');
      request.addEventListener('progress', function (_ref) {
        _ref.total;
            _ref.loaded;
        return callbackWrapper(request, null, {
          statusCode: request.status
        }, progressListener);
      });
    }
  };
  var request = xhr(options, function (error, response) {
    return callbackWrapper(request, error, response, progressListener);
  });
  return request;
};

var EventTarget = videojs.EventTarget;

var dashPlaylistUnchanged = function dashPlaylistUnchanged(a, b) {
  if (!isPlaylistUnchanged(a, b)) {
    return false;
  } // for dash the above check will often return true in scenarios where
  // the playlist actually has changed because mediaSequence isn't a
  // dash thing, and we often set it to 1. So if the playlists have the same amount
  // of segments we return true.
  // So for dash we need to make sure that the underlying segments are different.
  // if sidx changed then the playlists are different.


  if (a.sidx && b.sidx && (a.sidx.offset !== b.sidx.offset || a.sidx.length !== b.sidx.length)) {
    return false;
  } else if (!a.sidx && b.sidx || a.sidx && !b.sidx) {
    return false;
  } // one or the other does not have segments
  // there was a change.


  if (a.segments && !b.segments || !a.segments && b.segments) {
    return false;
  } // neither has segments nothing changed


  if (!a.segments && !b.segments) {
    return true;
  } // check segments themselves


  for (var i = 0; i < a.segments.length; i++) {
    var aSegment = a.segments[i];
    var bSegment = b.segments[i]; // if uris are different between segments there was a change

    if (aSegment.uri !== bSegment.uri) {
      return false;
    } // neither segment has a byterange, there will be no byterange change.


    if (!aSegment.byterange && !bSegment.byterange) {
      continue;
    }

    var aByterange = aSegment.byterange;
    var bByterange = bSegment.byterange; // if byterange only exists on one of the segments, there was a change.

    if (aByterange && !bByterange || !aByterange && bByterange) {
      return false;
    } // if both segments have byterange with different offsets, there was a change.


    if (aByterange.offset !== bByterange.offset || aByterange.length !== bByterange.length) {
      return false;
    }
  } // if everything was the same with segments, this is the same playlist.


  return true;
};
/**
 * Use the representation IDs from the mpd object to create groupIDs, the NAME is set to mandatory representation
 * ID in the parser. This allows for continuous playout across periods with the same representation IDs
 * (continuous periods as defined in DASH-IF 3.2.12). This is assumed in the mpd-parser as well. If we want to support
 * periods without continuous playback this function may need modification as well as the parser.
 */


var dashGroupId = function dashGroupId(type, group, label, playlist) {
  // If the manifest somehow does not have an ID (non-dash compliant), use the label.
  var playlistId = playlist.attributes.NAME || label;
  return "placeholder-uri-" + type + "-" + group + "-" + playlistId;
};
/**
 * Parses the main XML string and updates playlist URI references.
 *
 * @param {Object} config
 *        Object of arguments
 * @param {string} config.mainXml
 *        The mpd XML
 * @param {string} config.srcUrl
 *        The mpd URL
 * @param {Date} config.clientOffset
 *         A time difference between server and client
 * @param {Object} config.sidxMapping
 *        SIDX mappings for moof/mdat URIs and byte ranges
 * @return {Object}
 *         The parsed mpd manifest object
 */


var parseMainXml = function parseMainXml(_ref) {
  var mainXml = _ref.mainXml,
      srcUrl = _ref.srcUrl,
      clientOffset = _ref.clientOffset,
      sidxMapping = _ref.sidxMapping,
      previousManifest = _ref.previousManifest;
  var manifest = parse(mainXml, {
    manifestUri: srcUrl,
    clientOffset: clientOffset,
    sidxMapping: sidxMapping,
    previousManifest: previousManifest
  });
  addPropertiesToMain(manifest, srcUrl, dashGroupId);
  return manifest;
};
/**
 * Removes any mediaGroup labels that no longer exist in the newMain
 *
 * @param {Object} update
 *         The previous mpd object being updated
 * @param {Object} newMain
 *         The new mpd object
 */

var removeOldMediaGroupLabels = function removeOldMediaGroupLabels(update, newMain) {
  forEachMediaGroup(update, function (properties, type, group, label) {
    if (!(label in newMain.mediaGroups[type][group])) {
      delete update.mediaGroups[type][group][label];
    }
  });
};
/**
 * Returns a new main manifest that is the result of merging an updated main manifest
 * into the original version.
 *
 * @param {Object} oldMain
 *        The old parsed mpd object
 * @param {Object} newMain
 *        The updated parsed mpd object
 * @return {Object}
 *         A new object representing the original main manifest with the updated media
 *         playlists merged in
 */


var updateMain = function updateMain(oldMain, newMain, sidxMapping) {
  var noChanges = true;
  var update = merge(oldMain, {
    // These are top level properties that can be updated
    duration: newMain.duration,
    minimumUpdatePeriod: newMain.minimumUpdatePeriod,
    timelineStarts: newMain.timelineStarts
  }); // First update the playlists in playlist list

  for (var i = 0; i < newMain.playlists.length; i++) {
    var playlist = newMain.playlists[i];

    if (playlist.sidx) {
      var sidxKey = generateSidxKey(playlist.sidx); // add sidx segments to the playlist if we have all the sidx info already

      if (sidxMapping && sidxMapping[sidxKey] && sidxMapping[sidxKey].sidx) {
        addSidxSegmentsToPlaylist(playlist, sidxMapping[sidxKey].sidx, playlist.sidx.resolvedUri);
      }
    }

    var playlistUpdate = updateMain$1(update, playlist, dashPlaylistUnchanged);

    if (playlistUpdate) {
      update = playlistUpdate;
      noChanges = false;
    }
  } // Then update media group playlists


  forEachMediaGroup(newMain, function (properties, type, group, label) {
    if (properties.playlists && properties.playlists.length) {
      var id = properties.playlists[0].id;

      var _playlistUpdate = updateMain$1(update, properties.playlists[0], dashPlaylistUnchanged);

      if (_playlistUpdate) {
        update = _playlistUpdate; // add new mediaGroup label if it doesn't exist and assign the new mediaGroup.

        if (!(label in update.mediaGroups[type][group])) {
          update.mediaGroups[type][group][label] = properties;
        } // update the playlist reference within media groups


        update.mediaGroups[type][group][label].playlists[0] = update.playlists[id];
        noChanges = false;
      }
    }
  }); // remove mediaGroup labels and references that no longer exist in the newMain

  removeOldMediaGroupLabels(update, newMain);

  if (newMain.minimumUpdatePeriod !== oldMain.minimumUpdatePeriod) {
    noChanges = false;
  }

  if (noChanges) {
    return null;
  }

  return update;
}; // SIDX should be equivalent if the URI and byteranges of the SIDX match.
// If the SIDXs have maps, the two maps should match,
// both `a` and `b` missing SIDXs is considered matching.
// If `a` or `b` but not both have a map, they aren't matching.

var equivalentSidx = function equivalentSidx(a, b) {
  var neitherMap = Boolean(!a.map && !b.map);
  var equivalentMap = neitherMap || Boolean(a.map && b.map && a.map.byterange.offset === b.map.byterange.offset && a.map.byterange.length === b.map.byterange.length);
  return equivalentMap && a.uri === b.uri && a.byterange.offset === b.byterange.offset && a.byterange.length === b.byterange.length;
}; // exported for testing


var compareSidxEntry = function compareSidxEntry(playlists, oldSidxMapping) {
  var newSidxMapping = {};

  for (var id in playlists) {
    var playlist = playlists[id];
    var currentSidxInfo = playlist.sidx;

    if (currentSidxInfo) {
      var key = generateSidxKey(currentSidxInfo);

      if (!oldSidxMapping[key]) {
        break;
      }

      var savedSidxInfo = oldSidxMapping[key].sidxInfo;

      if (equivalentSidx(savedSidxInfo, currentSidxInfo)) {
        newSidxMapping[key] = oldSidxMapping[key];
      }
    }
  }

  return newSidxMapping;
};
/**
 *  A function that filters out changed items as they need to be requested separately.
 *
 *  The method is exported for testing
 *
 *  @param {Object} main the parsed mpd XML returned via mpd-parser
 *  @param {Object} oldSidxMapping the SIDX to compare against
 */

var filterChangedSidxMappings = function filterChangedSidxMappings(main, oldSidxMapping) {
  var videoSidx = compareSidxEntry(main.playlists, oldSidxMapping);
  var mediaGroupSidx = videoSidx;
  forEachMediaGroup(main, function (properties, mediaType, groupKey, labelKey) {
    if (properties.playlists && properties.playlists.length) {
      var playlists = properties.playlists;
      mediaGroupSidx = merge(mediaGroupSidx, compareSidxEntry(playlists, oldSidxMapping));
    }
  });
  return mediaGroupSidx;
};

var DashPlaylistLoader = /*#__PURE__*/function (_EventTarget) {
  _inheritsLoose(DashPlaylistLoader, _EventTarget);

  // DashPlaylistLoader must accept either a src url or a playlist because subsequent
  // playlist loader setups from media groups will expect to be able to pass a playlist
  // (since there aren't external URLs to media playlists with DASH)
  function DashPlaylistLoader(srcUrlOrPlaylist, vhs, options, mainPlaylistLoader) {
    var _this;

    if (options === void 0) {
      options = {};
    }

    _this = _EventTarget.call(this) || this;
    _this.mainPlaylistLoader_ = mainPlaylistLoader || _assertThisInitialized(_this);

    if (!mainPlaylistLoader) {
      _this.isMain_ = true;
    }

    var _options = options,
        _options$withCredenti = _options.withCredentials,
        withCredentials = _options$withCredenti === void 0 ? false : _options$withCredenti;
    _this.vhs_ = vhs;
    _this.withCredentials = withCredentials;
    _this.addMetadataToTextTrack = options.addMetadataToTextTrack;

    if (!srcUrlOrPlaylist) {
      throw new Error('A non-empty playlist URL or object is required');
    } // event naming?


    _this.on('minimumUpdatePeriod', function () {
      _this.refreshXml_();
    }); // live playlist staleness timeout


    _this.on('mediaupdatetimeout', function () {
      _this.refreshMedia_(_this.media().id);
    });

    _this.state = 'HAVE_NOTHING';
    _this.loadedPlaylists_ = {};
    _this.logger_ = logger('DashPlaylistLoader'); // initialize the loader state
    // The mainPlaylistLoader will be created with a string

    if (_this.isMain_) {
      _this.mainPlaylistLoader_.srcUrl = srcUrlOrPlaylist; // TODO: reset sidxMapping between period changes
      // once multi-period is refactored

      _this.mainPlaylistLoader_.sidxMapping_ = {};
    } else {
      _this.childPlaylist_ = srcUrlOrPlaylist;
    }

    return _this;
  }

  var _proto = DashPlaylistLoader.prototype;

  _proto.requestErrored_ = function requestErrored_(err, request, startingState) {
    // disposed
    if (!this.request) {
      return true;
    } // pending request is cleared


    this.request = null;

    if (err) {
      // use the provided error object or create one
      // based on the request/response
      this.error = typeof err === 'object' && !(err instanceof Error) ? err : {
        status: request.status,
        message: 'DASH request error at URL: ' + request.uri,
        response: request.response,
        // MEDIA_ERR_NETWORK
        code: 2,
        metadata: err.metadata
      };

      if (startingState) {
        this.state = startingState;
      }

      this.trigger('error');
      return true;
    }
  }
  /**
   * Verify that the container of the sidx segment can be parsed
   * and if it can, get and parse that segment.
   */
  ;

  _proto.addSidxSegments_ = function addSidxSegments_(playlist, startingState, cb) {
    var _this2 = this;

    var sidxKey = playlist.sidx && generateSidxKey(playlist.sidx); // playlist lacks sidx or sidx segments were added to this playlist already.

    if (!playlist.sidx || !sidxKey || this.mainPlaylistLoader_.sidxMapping_[sidxKey]) {
      // keep this function async
      this.mediaRequest_ = window$1.setTimeout(function () {
        return cb(false);
      }, 0);
      return;
    } // resolve the segment URL relative to the playlist


    var uri = resolveManifestRedirect(playlist.sidx.resolvedUri);

    var fin = function fin(err, request) {
      // TODO: add error metdata here once we create an error type in video.js
      if (_this2.requestErrored_(err, request, startingState)) {
        return;
      }

      var sidxMapping = _this2.mainPlaylistLoader_.sidxMapping_;
      var sidx;

      try {
        sidx = parseSidx(toUint8(request.response).subarray(8));
      } catch (e) {
        e.metadata = {
          errorType: videojs.Error.DashManifestSidxParsingError
        }; // sidx parsing failed.

        _this2.requestErrored_(e, request, startingState);

        return;
      }

      sidxMapping[sidxKey] = {
        sidxInfo: playlist.sidx,
        sidx: sidx
      };
      addSidxSegmentsToPlaylist(playlist, sidx, playlist.sidx.resolvedUri);
      return cb(true);
    };

    this.request = containerRequest(uri, this.vhs_.xhr, function (err, request, container, bytes) {
      if (err) {
        return fin(err, request);
      }

      if (!container || container !== 'mp4') {
        var sidxContainer = container || 'unknown';
        return fin({
          status: request.status,
          message: "Unsupported " + sidxContainer + " container type for sidx segment at URL: " + uri,
          // response is just bytes in this case
          // but we really don't want to return that.
          response: '',
          playlist: playlist,
          internal: true,
          playlistExclusionDuration: Infinity,
          // MEDIA_ERR_NETWORK
          code: 2,
          metadata: {
            errorType: videojs.Error.UnsupportedSidxContainer,
            sidxContainer: sidxContainer
          }
        }, request);
      } // if we already downloaded the sidx bytes in the container request, use them


      var _playlist$sidx$bytera = playlist.sidx.byterange,
          offset = _playlist$sidx$bytera.offset,
          length = _playlist$sidx$bytera.length;

      if (bytes.length >= length + offset) {
        return fin(err, {
          response: bytes.subarray(offset, offset + length),
          status: request.status,
          uri: request.uri
        });
      } // otherwise request sidx bytes


      _this2.request = _this2.vhs_.xhr({
        uri: uri,
        responseType: 'arraybuffer',
        headers: segmentXhrHeaders({
          byterange: playlist.sidx.byterange
        })
      }, fin);
    });
  };

  _proto.dispose = function dispose() {
    this.trigger('dispose');
    this.stopRequest();
    this.loadedPlaylists_ = {};
    window$1.clearTimeout(this.minimumUpdatePeriodTimeout_);
    window$1.clearTimeout(this.mediaRequest_);
    window$1.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;
    this.mediaRequest_ = null;
    this.minimumUpdatePeriodTimeout_ = null;

    if (this.mainPlaylistLoader_.createMupOnMedia_) {
      this.off('loadedmetadata', this.mainPlaylistLoader_.createMupOnMedia_);
      this.mainPlaylistLoader_.createMupOnMedia_ = null;
    }

    this.off();
  };

  _proto.hasPendingRequest = function hasPendingRequest() {
    return this.request || this.mediaRequest_;
  };

  _proto.stopRequest = function stopRequest() {
    if (this.request) {
      var oldRequest = this.request;
      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  };

  _proto.media = function media(playlist) {
    var _this3 = this;

    // getter
    if (!playlist) {
      return this.media_;
    } // setter


    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    var startingState = this.state; // find the playlist object if the target playlist has been specified by URI

    if (typeof playlist === 'string') {
      if (!this.mainPlaylistLoader_.main.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }

      playlist = this.mainPlaylistLoader_.main.playlists[playlist];
    }

    var mediaChange = !this.media_ || playlist.id !== this.media_.id; // switch to previously loaded playlists immediately

    if (mediaChange && this.loadedPlaylists_[playlist.id] && this.loadedPlaylists_[playlist.id].endList) {
      this.state = 'HAVE_METADATA';
      this.media_ = playlist; // trigger media change if the active media has been updated

      if (mediaChange) {
        this.trigger('mediachanging');
        this.trigger('mediachange');
      }

      return;
    } // switching to the active playlist is a no-op


    if (!mediaChange) {
      return;
    } // switching from an already loaded playlist


    if (this.media_) {
      this.trigger('mediachanging');
    }

    this.addSidxSegments_(playlist, startingState, function (sidxChanged) {
      // everything is ready just continue to haveMetadata
      _this3.haveMetadata({
        startingState: startingState,
        playlist: playlist
      });
    });
  };

  _proto.haveMetadata = function haveMetadata(_ref2) {
    var startingState = _ref2.startingState,
        playlist = _ref2.playlist;
    this.state = 'HAVE_METADATA';
    this.loadedPlaylists_[playlist.id] = playlist;
    this.mediaRequest_ = null; // This will trigger loadedplaylist

    this.refreshMedia_(playlist.id); // fire loadedmetadata the first time a media playlist is loaded
    // to resolve setup of media groups

    if (startingState === 'HAVE_MAIN_MANIFEST') {
      this.trigger('loadedmetadata');
    } else {
      // trigger media change if the active media has been updated
      this.trigger('mediachange');
    }
  };

  _proto.pause = function pause() {
    if (this.mainPlaylistLoader_.createMupOnMedia_) {
      this.off('loadedmetadata', this.mainPlaylistLoader_.createMupOnMedia_);
      this.mainPlaylistLoader_.createMupOnMedia_ = null;
    }

    this.stopRequest();
    window$1.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;

    if (this.isMain_) {
      window$1.clearTimeout(this.mainPlaylistLoader_.minimumUpdatePeriodTimeout_);
      this.mainPlaylistLoader_.minimumUpdatePeriodTimeout_ = null;
    }

    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
  };

  _proto.load = function load(isFinalRendition) {
    var _this4 = this;

    window$1.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;
    var media = this.media();

    if (isFinalRendition) {
      var delay = media ? media.targetDuration / 2 * 1000 : 5 * 1000;
      this.mediaUpdateTimeout = window$1.setTimeout(function () {
        return _this4.load();
      }, delay);
      return;
    } // because the playlists are internal to the manifest, load should either load the
    // main manifest, or do nothing but trigger an event


    if (!this.started) {
      this.start();
      return;
    }

    if (media && !media.endList) {
      // Check to see if this is the main loader and the MUP was cleared (this happens
      // when the loader was paused). `media` should be set at this point since one is always
      // set during `start()`.
      if (this.isMain_ && !this.minimumUpdatePeriodTimeout_) {
        // Trigger minimumUpdatePeriod to refresh the main manifest
        this.trigger('minimumUpdatePeriod'); // Since there was no prior minimumUpdatePeriodTimeout it should be recreated

        this.updateMinimumUpdatePeriodTimeout_();
      }

      this.trigger('mediaupdatetimeout');
    } else {
      this.trigger('loadedplaylist');
    }
  };

  _proto.start = function start() {
    var _this5 = this;

    this.started = true; // We don't need to request the main manifest again
    // Call this asynchronously to match the xhr request behavior below

    if (!this.isMain_) {
      this.mediaRequest_ = window$1.setTimeout(function () {
        return _this5.haveMain_();
      }, 0);
      return;
    }

    this.requestMain_(function (req, mainChanged) {
      _this5.haveMain_();

      if (!_this5.hasPendingRequest() && !_this5.media_) {
        _this5.media(_this5.mainPlaylistLoader_.main.playlists[0]);
      }
    });
  };

  _proto.requestMain_ = function requestMain_(cb) {
    var _this6 = this;

    this.request = this.vhs_.xhr({
      uri: this.mainPlaylistLoader_.srcUrl,
      withCredentials: this.withCredentials,
      requestType: 'dash-manifest'
    }, function (error, req) {
      if (_this6.requestErrored_(error, req)) {
        if (_this6.state === 'HAVE_NOTHING') {
          _this6.started = false;
        }

        return;
      }

      var mainChanged = req.responseText !== _this6.mainPlaylistLoader_.mainXml_;
      _this6.mainPlaylistLoader_.mainXml_ = req.responseText;

      if (req.responseHeaders && req.responseHeaders.date) {
        _this6.mainLoaded_ = Date.parse(req.responseHeaders.date);
      } else {
        _this6.mainLoaded_ = Date.now();
      }

      _this6.mainPlaylistLoader_.srcUrl = resolveManifestRedirect(_this6.mainPlaylistLoader_.srcUrl, req);

      if (mainChanged) {
        _this6.handleMain_();

        _this6.syncClientServerClock_(function () {
          return cb(req, mainChanged);
        });

        return;
      }

      return cb(req, mainChanged);
    });
  }
  /**
   * Parses the main xml for UTCTiming node to sync the client clock to the server
   * clock. If the UTCTiming node requires a HEAD or GET request, that request is made.
   *
   * @param {Function} done
   *        Function to call when clock sync has completed
   */
  ;

  _proto.syncClientServerClock_ = function syncClientServerClock_(done) {
    var _this7 = this;

    var utcTiming = parseUTCTiming(this.mainPlaylistLoader_.mainXml_); // No UTCTiming element found in the mpd. Use Date header from mpd request as the
    // server clock

    if (utcTiming === null) {
      this.mainPlaylistLoader_.clientOffset_ = this.mainLoaded_ - Date.now();
      return done();
    }

    if (utcTiming.method === 'DIRECT') {
      this.mainPlaylistLoader_.clientOffset_ = utcTiming.value - Date.now();
      return done();
    }

    this.request = this.vhs_.xhr({
      uri: resolveUrl(this.mainPlaylistLoader_.srcUrl, utcTiming.value),
      method: utcTiming.method,
      withCredentials: this.withCredentials,
      requestType: 'dash-clock-sync'
    }, function (error, req) {
      // disposed
      if (!_this7.request) {
        return;
      }

      if (error) {
        // sync request failed, fall back to using date header from mpd
        // TODO: log warning
        _this7.mainPlaylistLoader_.clientOffset_ = _this7.mainLoaded_ - Date.now();
        return done();
      }

      var serverTime;

      if (utcTiming.method === 'HEAD') {
        if (!req.responseHeaders || !req.responseHeaders.date) {
          // expected date header not preset, fall back to using date header from mpd
          // TODO: log warning
          serverTime = _this7.mainLoaded_;
        } else {
          serverTime = Date.parse(req.responseHeaders.date);
        }
      } else {
        serverTime = Date.parse(req.responseText);
      }

      _this7.mainPlaylistLoader_.clientOffset_ = serverTime - Date.now();
      done();
    });
  };

  _proto.haveMain_ = function haveMain_() {
    this.state = 'HAVE_MAIN_MANIFEST';

    if (this.isMain_) {
      // We have the main playlist at this point, so
      // trigger this to allow PlaylistController
      // to make an initial playlist selection
      this.trigger('loadedplaylist');
    } else if (!this.media_) {
      // no media playlist was specifically selected so select
      // the one the child playlist loader was created with
      this.media(this.childPlaylist_);
    }
  };

  _proto.handleMain_ = function handleMain_() {
    // clear media request
    this.mediaRequest_ = null;
    var oldMain = this.mainPlaylistLoader_.main;
    var newMain = parseMainXml({
      mainXml: this.mainPlaylistLoader_.mainXml_,
      srcUrl: this.mainPlaylistLoader_.srcUrl,
      clientOffset: this.mainPlaylistLoader_.clientOffset_,
      sidxMapping: this.mainPlaylistLoader_.sidxMapping_,
      previousManifest: oldMain
    }); // if we have an old main to compare the new main against

    if (oldMain) {
      newMain = updateMain(oldMain, newMain, this.mainPlaylistLoader_.sidxMapping_);
    } // only update main if we have a new main


    this.mainPlaylistLoader_.main = newMain ? newMain : oldMain;
    var location = this.mainPlaylistLoader_.main.locations && this.mainPlaylistLoader_.main.locations[0];

    if (location && location !== this.mainPlaylistLoader_.srcUrl) {
      this.mainPlaylistLoader_.srcUrl = location;
    }

    if (!oldMain || newMain && newMain.minimumUpdatePeriod !== oldMain.minimumUpdatePeriod) {
      this.updateMinimumUpdatePeriodTimeout_();
    }

    this.addEventStreamToMetadataTrack_(newMain);
    return Boolean(newMain);
  };

  _proto.updateMinimumUpdatePeriodTimeout_ = function updateMinimumUpdatePeriodTimeout_() {
    var mpl = this.mainPlaylistLoader_; // cancel any pending creation of mup on media
    // a new one will be added if needed.

    if (mpl.createMupOnMedia_) {
      mpl.off('loadedmetadata', mpl.createMupOnMedia_);
      mpl.createMupOnMedia_ = null;
    } // clear any pending timeouts


    if (mpl.minimumUpdatePeriodTimeout_) {
      window$1.clearTimeout(mpl.minimumUpdatePeriodTimeout_);
      mpl.minimumUpdatePeriodTimeout_ = null;
    }

    var mup = mpl.main && mpl.main.minimumUpdatePeriod; // If the minimumUpdatePeriod has a value of 0, that indicates that the current
    // MPD has no future validity, so a new one will need to be acquired when new
    // media segments are to be made available. Thus, we use the target duration
    // in this case

    if (mup === 0) {
      if (mpl.media()) {
        mup = mpl.media().targetDuration * 1000;
      } else {
        mpl.createMupOnMedia_ = mpl.updateMinimumUpdatePeriodTimeout_;
        mpl.one('loadedmetadata', mpl.createMupOnMedia_);
      }
    } // if minimumUpdatePeriod is invalid or <= zero, which
    // can happen when a live video becomes VOD. skip timeout
    // creation.


    if (typeof mup !== 'number' || mup <= 0) {
      if (mup < 0) {
        this.logger_("found invalid minimumUpdatePeriod of " + mup + ", not setting a timeout");
      }

      return;
    }

    this.createMUPTimeout_(mup);
  };

  _proto.createMUPTimeout_ = function createMUPTimeout_(mup) {
    var mpl = this.mainPlaylistLoader_;
    mpl.minimumUpdatePeriodTimeout_ = window$1.setTimeout(function () {
      mpl.minimumUpdatePeriodTimeout_ = null;
      mpl.trigger('minimumUpdatePeriod');
      mpl.createMUPTimeout_(mup);
    }, mup);
  }
  /**
   * Sends request to refresh the main xml and updates the parsed main manifest
   */
  ;

  _proto.refreshXml_ = function refreshXml_() {
    var _this8 = this;

    this.requestMain_(function (req, mainChanged) {
      if (!mainChanged) {
        return;
      }

      if (_this8.media_) {
        _this8.media_ = _this8.mainPlaylistLoader_.main.playlists[_this8.media_.id];
      } // This will filter out updated sidx info from the mapping


      _this8.mainPlaylistLoader_.sidxMapping_ = filterChangedSidxMappings(_this8.mainPlaylistLoader_.main, _this8.mainPlaylistLoader_.sidxMapping_);

      _this8.addSidxSegments_(_this8.media(), _this8.state, function (sidxChanged) {
        // TODO: do we need to reload the current playlist?
        _this8.refreshMedia_(_this8.media().id);
      });
    });
  }
  /**
   * Refreshes the media playlist by re-parsing the main xml and updating playlist
   * references. If this is an alternate loader, the updated parsed manifest is retrieved
   * from the main loader.
   */
  ;

  _proto.refreshMedia_ = function refreshMedia_(mediaID) {
    var _this9 = this;

    if (!mediaID) {
      throw new Error('refreshMedia_ must take a media id');
    } // for main we have to reparse the main xml
    // to re-create segments based on current timing values
    // which may change media. We only skip updating the main manifest
    // if this is the first time this.media_ is being set.
    // as main was just parsed in that case.


    if (this.media_ && this.isMain_) {
      this.handleMain_();
    }

    var playlists = this.mainPlaylistLoader_.main.playlists;
    var mediaChanged = !this.media_ || this.media_ !== playlists[mediaID];

    if (mediaChanged) {
      this.media_ = playlists[mediaID];
    } else {
      this.trigger('playlistunchanged');
    }

    if (!this.mediaUpdateTimeout) {
      var createMediaUpdateTimeout = function createMediaUpdateTimeout() {
        if (_this9.media().endList) {
          return;
        }

        _this9.mediaUpdateTimeout = window$1.setTimeout(function () {
          _this9.trigger('mediaupdatetimeout');

          createMediaUpdateTimeout();
        }, refreshDelay(_this9.media(), Boolean(mediaChanged)));
      };

      createMediaUpdateTimeout();
    }

    this.trigger('loadedplaylist');
  }
  /**
   * Takes eventstream data from a parsed DASH manifest and adds it to the metadata text track.
   *
   * @param {manifest} newMain the newly parsed manifest
   */
  ;

  _proto.addEventStreamToMetadataTrack_ = function addEventStreamToMetadataTrack_(newMain) {
    // Only add new event stream metadata if we have a new manifest.
    if (newMain && this.mainPlaylistLoader_.main.eventStream) {
      // convert EventStream to ID3-like data.
      var metadataArray = this.mainPlaylistLoader_.main.eventStream.map(function (eventStreamNode) {
        return {
          cueTime: eventStreamNode.start,
          frames: [{
            data: eventStreamNode.messageData
          }]
        };
      });
      this.addMetadataToTextTrack('EventStream', metadataArray, this.mainPlaylistLoader_.main.duration);
    }
  }
  /**
   * Returns the key ID set from a playlist
   *
   * @param {playlist} playlist to fetch the key ID set from.
   * @return a Set of 32 digit hex strings that represent the unique keyIds for that playlist.
   */
  ;

  _proto.getKeyIdSet = function getKeyIdSet(playlist) {
    if (playlist.contentProtection) {
      var keyIds = new Set();

      for (var keysystem in playlist.contentProtection) {
        var defaultKID = playlist.contentProtection[keysystem].attributes['cenc:default_KID'];

        if (defaultKID) {
          // DASH keyIds are separated by dashes.
          keyIds.add(defaultKID.replace(/-/g, '').toLowerCase());
        }
      }

      return keyIds;
    }
  };

  return DashPlaylistLoader;
}(EventTarget);

var Config = {
  GOAL_BUFFER_LENGTH: 30,
  MAX_GOAL_BUFFER_LENGTH: 60,
  BACK_BUFFER_LENGTH: 30,
  GOAL_BUFFER_LENGTH_RATE: 1,
  // 0.5 MB/s
  INITIAL_BANDWIDTH: 4194304,
  // A fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  BANDWIDTH_VARIANCE: 1.2,
  // How much of the buffer must be filled before we consider upswitching
  BUFFER_LOW_WATER_LINE: 0,
  MAX_BUFFER_LOW_WATER_LINE: 30,
  // TODO: Remove this when experimentalBufferBasedABR is removed
  EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE: 16,
  BUFFER_LOW_WATER_LINE_RATE: 1,
  // If the buffer is greater than the high water line, we won't switch down
  BUFFER_HIGH_WATER_LINE: 30
};

var stringToArrayBuffer = function stringToArrayBuffer(string) {
  var view = new Uint8Array(new ArrayBuffer(string.length));

  for (var i = 0; i < string.length; i++) {
    view[i] = string.charCodeAt(i);
  }

  return view.buffer;
};

/* global Blob, BlobBuilder, Worker */
// unify worker interface
var browserWorkerPolyFill = function browserWorkerPolyFill(workerObj) {
  // node only supports on/off
  workerObj.on = workerObj.addEventListener;
  workerObj.off = workerObj.removeEventListener;
  return workerObj;
};

var createObjectURL = function createObjectURL(str) {
  try {
    return URL.createObjectURL(new Blob([str], {
      type: 'application/javascript'
    }));
  } catch (e) {
    var blob = new BlobBuilder();
    blob.append(str);
    return URL.createObjectURL(blob.getBlob());
  }
};

var factory = function factory(code) {
  return function () {
    var objectUrl = createObjectURL(code);
    var worker = browserWorkerPolyFill(new Worker(objectUrl));
    worker.objURL = objectUrl;
    var terminate = worker.terminate;
    worker.on = worker.addEventListener;
    worker.off = worker.removeEventListener;

    worker.terminate = function () {
      URL.revokeObjectURL(objectUrl);
      return terminate.call(this);
    };

    return worker;
  };
};
var transform = function transform(code) {
  return "var browserWorkerPolyFill = " + browserWorkerPolyFill.toString() + ";\n" + 'browserWorkerPolyFill(self);\n' + code;
};

var getWorkerString = function getWorkerString(fn) {
  return fn.toString().replace(/^function.+?{/, '').slice(0, -1);
};

/* rollup-plugin-worker-factory start for worker!C:\Users\pjaspinski\Desktop\tellyo\http-streaming\src\transmuxer-worker.js */
var workerCode$1 = transform(getWorkerString(function () {
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * A lightweight readable stream implemention that handles event dispatching.
   * Objects that inherit from streams should call init in their constructors.
   */

  var Stream = function Stream() {
    this.init = function () {
      var listeners = {};
      /**
       * Add a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} the callback to be invoked when an event of
       * the specified type occurs
       */

      this.on = function (type, listener) {
        if (!listeners[type]) {
          listeners[type] = [];
        }

        listeners[type] = listeners[type].concat(listener);
      };
      /**
       * Remove a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} a function previously registered for this
       * type of event through `on`
       */


      this.off = function (type, listener) {
        var index;

        if (!listeners[type]) {
          return false;
        }

        index = listeners[type].indexOf(listener);
        listeners[type] = listeners[type].slice();
        listeners[type].splice(index, 1);
        return index > -1;
      };
      /**
       * Trigger an event of the specified type on this stream. Any additional
       * arguments to this function are passed as parameters to event listeners.
       * @param type {string} the event name
       */


      this.trigger = function (type) {
        var callbacks, i, length, args;
        callbacks = listeners[type];

        if (!callbacks) {
          return;
        } // Slicing the arguments on every invocation of this method
        // can add a significant amount of overhead. Avoid the
        // intermediate object creation for the common case of a
        // single callback argument


        if (arguments.length === 2) {
          length = callbacks.length;

          for (i = 0; i < length; ++i) {
            callbacks[i].call(this, arguments[1]);
          }
        } else {
          args = [];
          i = arguments.length;

          for (i = 1; i < arguments.length; ++i) {
            args.push(arguments[i]);
          }

          length = callbacks.length;

          for (i = 0; i < length; ++i) {
            callbacks[i].apply(this, args);
          }
        }
      };
      /**
       * Destroys the stream and cleans up.
       */


      this.dispose = function () {
        listeners = {};
      };
    };
  };
  /**
   * Forwards all `data` events on this stream to the destination stream. The
   * destination stream should provide a method `push` to receive the data
   * events as they arrive.
   * @param destination {stream} the stream that will receive all `data` events
   * @param autoFlush {boolean} if false, we will not call `flush` on the destination
   *                            when the current stream emits a 'done' event
   * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
   */


  Stream.prototype.pipe = function (destination) {
    this.on('data', function (data) {
      destination.push(data);
    });
    this.on('done', function (flushSource) {
      destination.flush(flushSource);
    });
    this.on('partialdone', function (flushSource) {
      destination.partialFlush(flushSource);
    });
    this.on('endedtimeline', function (flushSource) {
      destination.endTimeline(flushSource);
    });
    this.on('reset', function (flushSource) {
      destination.reset(flushSource);
    });
    return destination;
  }; // Default stream functions that are expected to be overridden to perform
  // actual work. These are provided by the prototype as a sort of no-op
  // implementation so that we don't have to check for their existence in the
  // `pipe` function above.


  Stream.prototype.push = function (data) {
    this.trigger('data', data);
  };

  Stream.prototype.flush = function (flushSource) {
    this.trigger('done', flushSource);
  };

  Stream.prototype.partialFlush = function (flushSource) {
    this.trigger('partialdone', flushSource);
  };

  Stream.prototype.endTimeline = function (flushSource) {
    this.trigger('endedtimeline', flushSource);
  };

  Stream.prototype.reset = function (flushSource) {
    this.trigger('reset', flushSource);
  };

  var stream = Stream;
  var MAX_UINT32$1 = Math.pow(2, 32);

  var getUint64$2 = function getUint64(uint8) {
    var dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    var value;

    if (dv.getBigUint64) {
      value = dv.getBigUint64(0);

      if (value < Number.MAX_SAFE_INTEGER) {
        return Number(value);
      }

      return value;
    }

    return dv.getUint32(0) * MAX_UINT32$1 + dv.getUint32(4);
  };

  var numbers = {
    getUint64: getUint64$2,
    MAX_UINT32: MAX_UINT32$1
  };
  var MAX_UINT32 = numbers.MAX_UINT32;
  var box, dinf, esds, ftyp, mdat, mfhd, minf, moof, moov, mvex, mvhd, trak, tkhd, mdia, mdhd, hdlr, sdtp, stbl, stsd, traf, trex, trun$1, types, MAJOR_BRAND, MINOR_VERSION, AVC1_BRAND, VIDEO_HDLR, AUDIO_HDLR, HDLR_TYPES, VMHD, SMHD, DREF, STCO, STSC, STSZ, STTS; // pre-calculate constants

  (function () {
    var i;
    types = {
      avc1: [],
      // codingname
      avcC: [],
      btrt: [],
      dinf: [],
      dref: [],
      esds: [],
      ftyp: [],
      hdlr: [],
      mdat: [],
      mdhd: [],
      mdia: [],
      mfhd: [],
      minf: [],
      moof: [],
      moov: [],
      mp4a: [],
      // codingname
      mvex: [],
      mvhd: [],
      pasp: [],
      sdtp: [],
      smhd: [],
      stbl: [],
      stco: [],
      stsc: [],
      stsd: [],
      stsz: [],
      stts: [],
      styp: [],
      tfdt: [],
      tfhd: [],
      traf: [],
      trak: [],
      trun: [],
      trex: [],
      tkhd: [],
      vmhd: []
    }; // In environments where Uint8Array is undefined (e.g., IE8), skip set up so that we
    // don't throw an error

    if (typeof Uint8Array === 'undefined') {
      return;
    }

    for (i in types) {
      if (types.hasOwnProperty(i)) {
        types[i] = [i.charCodeAt(0), i.charCodeAt(1), i.charCodeAt(2), i.charCodeAt(3)];
      }
    }

    MAJOR_BRAND = new Uint8Array(['i'.charCodeAt(0), 's'.charCodeAt(0), 'o'.charCodeAt(0), 'm'.charCodeAt(0)]);
    AVC1_BRAND = new Uint8Array(['a'.charCodeAt(0), 'v'.charCodeAt(0), 'c'.charCodeAt(0), '1'.charCodeAt(0)]);
    MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
    VIDEO_HDLR = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x76, 0x69, 0x64, 0x65, // handler_type: 'vide'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x56, 0x69, 0x64, 0x65, 0x6f, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'VideoHandler'
    ]);
    AUDIO_HDLR = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x53, 0x6f, 0x75, 0x6e, 0x64, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'SoundHandler'
    ]);
    HDLR_TYPES = {
      video: VIDEO_HDLR,
      audio: AUDIO_HDLR
    };
    DREF = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // entry_count
    0x00, 0x00, 0x00, 0x0c, // entry_size
    0x75, 0x72, 0x6c, 0x20, // 'url' type
    0x00, // version 0
    0x00, 0x00, 0x01 // entry_flags
    ]);
    SMHD = new Uint8Array([0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, // balance, 0 means centered
    0x00, 0x00 // reserved
    ]);
    STCO = new Uint8Array([0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00 // entry_count
    ]);
    STSC = STCO;
    STSZ = new Uint8Array([0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // sample_size
    0x00, 0x00, 0x00, 0x00 // sample_count
    ]);
    STTS = STCO;
    VMHD = new Uint8Array([0x00, // version
    0x00, 0x00, 0x01, // flags
    0x00, 0x00, // graphicsmode
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00 // opcolor
    ]);
  })();

  box = function box(type) {
    var payload = [],
        size = 0,
        i,
        result,
        view;

    for (i = 1; i < arguments.length; i++) {
      payload.push(arguments[i]);
    }

    i = payload.length; // calculate the total size we need to allocate

    while (i--) {
      size += payload[i].byteLength;
    }

    result = new Uint8Array(size + 8);
    view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    view.setUint32(0, result.byteLength);
    result.set(type, 4); // copy the payload into the result

    for (i = 0, size = 8; i < payload.length; i++) {
      result.set(payload[i], size);
      size += payload[i].byteLength;
    }

    return result;
  };

  dinf = function dinf() {
    return box(types.dinf, box(types.dref, DREF));
  };

  esds = function esds(track) {
    return box(types.esds, new Uint8Array([0x00, // version
    0x00, 0x00, 0x00, // flags
    // ES_Descriptor
    0x03, // tag, ES_DescrTag
    0x19, // length
    0x00, 0x00, // ES_ID
    0x00, // streamDependenceFlag, URL_flag, reserved, streamPriority
    // DecoderConfigDescriptor
    0x04, // tag, DecoderConfigDescrTag
    0x11, // length
    0x40, // object type
    0x15, // streamType
    0x00, 0x06, 0x00, // bufferSizeDB
    0x00, 0x00, 0xda, 0xc0, // maxBitrate
    0x00, 0x00, 0xda, 0xc0, // avgBitrate
    // DecoderSpecificInfo
    0x05, // tag, DecoderSpecificInfoTag
    0x02, // length
    // ISO/IEC 14496-3, AudioSpecificConfig
    // for samplingFrequencyIndex see ISO/IEC 13818-7:2006, 8.1.3.2.2, Table 35
    track.audioobjecttype << 3 | track.samplingfrequencyindex >>> 1, track.samplingfrequencyindex << 7 | track.channelcount << 3, 0x06, 0x01, 0x02 // GASpecificConfig
    ]));
  };

  ftyp = function ftyp() {
    return box(types.ftyp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND, AVC1_BRAND);
  };

  hdlr = function hdlr(type) {
    return box(types.hdlr, HDLR_TYPES[type]);
  };

  mdat = function mdat(data) {
    return box(types.mdat, data);
  };

  mdhd = function mdhd(track) {
    var result = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x02, // creation_time
    0x00, 0x00, 0x00, 0x03, // modification_time
    0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second
    track.duration >>> 24 & 0xFF, track.duration >>> 16 & 0xFF, track.duration >>> 8 & 0xFF, track.duration & 0xFF, // duration
    0x55, 0xc4, // 'und' language (undetermined)
    0x00, 0x00]); // Use the sample rate from the track metadata, when it is
    // defined. The sample rate can be parsed out of an ADTS header, for
    // instance.

    if (track.samplerate) {
      result[12] = track.samplerate >>> 24 & 0xFF;
      result[13] = track.samplerate >>> 16 & 0xFF;
      result[14] = track.samplerate >>> 8 & 0xFF;
      result[15] = track.samplerate & 0xFF;
    }

    return box(types.mdhd, result);
  };

  mdia = function mdia(track) {
    return box(types.mdia, mdhd(track), hdlr(track.type), minf(track));
  };

  mfhd = function mfhd(sequenceNumber) {
    return box(types.mfhd, new Uint8Array([0x00, 0x00, 0x00, 0x00, // flags
    (sequenceNumber & 0xFF000000) >> 24, (sequenceNumber & 0xFF0000) >> 16, (sequenceNumber & 0xFF00) >> 8, sequenceNumber & 0xFF // sequence_number
    ]));
  };

  minf = function minf(track) {
    return box(types.minf, track.type === 'video' ? box(types.vmhd, VMHD) : box(types.smhd, SMHD), dinf(), stbl(track));
  };

  moof = function moof(sequenceNumber, tracks) {
    var trackFragments = [],
        i = tracks.length; // build traf boxes for each track fragment

    while (i--) {
      trackFragments[i] = traf(tracks[i]);
    }

    return box.apply(null, [types.moof, mfhd(sequenceNumber)].concat(trackFragments));
  };
  /**
   * Returns a movie box.
   * @param tracks {array} the tracks associated with this movie
   * @see ISO/IEC 14496-12:2012(E), section 8.2.1
   */


  moov = function moov(tracks) {
    var i = tracks.length,
        boxes = [];

    while (i--) {
      boxes[i] = trak(tracks[i]);
    }

    return box.apply(null, [types.moov, mvhd(0xffffffff)].concat(boxes).concat(mvex(tracks)));
  };

  mvex = function mvex(tracks) {
    var i = tracks.length,
        boxes = [];

    while (i--) {
      boxes[i] = trex(tracks[i]);
    }

    return box.apply(null, [types.mvex].concat(boxes));
  };

  mvhd = function mvhd(duration) {
    var bytes = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // creation_time
    0x00, 0x00, 0x00, 0x02, // modification_time
    0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second
    (duration & 0xFF000000) >> 24, (duration & 0xFF0000) >> 16, (duration & 0xFF00) >> 8, duration & 0xFF, // duration
    0x00, 0x01, 0x00, 0x00, // 1.0 rate
    0x01, 0x00, // 1.0 volume
    0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // pre_defined
    0xff, 0xff, 0xff, 0xff // next_track_ID
    ]);
    return box(types.mvhd, bytes);
  };

  sdtp = function sdtp(track) {
    var samples = track.samples || [],
        bytes = new Uint8Array(4 + samples.length),
        flags,
        i; // leave the full box header (4 bytes) all zero
    // write the sample table

    for (i = 0; i < samples.length; i++) {
      flags = samples[i].flags;
      bytes[i + 4] = flags.dependsOn << 4 | flags.isDependedOn << 2 | flags.hasRedundancy;
    }

    return box(types.sdtp, bytes);
  };

  stbl = function stbl(track) {
    return box(types.stbl, stsd(track), box(types.stts, STTS), box(types.stsc, STSC), box(types.stsz, STSZ), box(types.stco, STCO));
  };

  (function () {
    var videoSample, audioSample;

    stsd = function stsd(track) {
      return box(types.stsd, new Uint8Array([0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x01]), track.type === 'video' ? videoSample(track) : audioSample(track));
    };

    videoSample = function videoSample(track) {
      var sps = track.sps || [],
          pps = track.pps || [],
          sequenceParameterSets = [],
          pictureParameterSets = [],
          i,
          avc1Box; // assemble the SPSs

      for (i = 0; i < sps.length; i++) {
        sequenceParameterSets.push((sps[i].byteLength & 0xFF00) >>> 8);
        sequenceParameterSets.push(sps[i].byteLength & 0xFF); // sequenceParameterSetLength

        sequenceParameterSets = sequenceParameterSets.concat(Array.prototype.slice.call(sps[i])); // SPS
      } // assemble the PPSs


      for (i = 0; i < pps.length; i++) {
        pictureParameterSets.push((pps[i].byteLength & 0xFF00) >>> 8);
        pictureParameterSets.push(pps[i].byteLength & 0xFF);
        pictureParameterSets = pictureParameterSets.concat(Array.prototype.slice.call(pps[i]));
      }

      avc1Box = [types.avc1, new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data_reference_index
      0x00, 0x00, // pre_defined
      0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // pre_defined
      (track.width & 0xff00) >> 8, track.width & 0xff, // width
      (track.height & 0xff00) >> 8, track.height & 0xff, // height
      0x00, 0x48, 0x00, 0x00, // horizresolution
      0x00, 0x48, 0x00, 0x00, // vertresolution
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // frame_count
      0x13, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x6a, 0x73, 0x2d, 0x63, 0x6f, 0x6e, 0x74, 0x72, 0x69, 0x62, 0x2d, 0x68, 0x6c, 0x73, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // compressorname
      0x00, 0x18, // depth = 24
      0x11, 0x11 // pre_defined = -1
      ]), box(types.avcC, new Uint8Array([0x01, // configurationVersion
      track.profileIdc, // AVCProfileIndication
      track.profileCompatibility, // profile_compatibility
      track.levelIdc, // AVCLevelIndication
      0xff // lengthSizeMinusOne, hard-coded to 4 bytes
      ].concat([sps.length], // numOfSequenceParameterSets
      sequenceParameterSets, // "SPS"
      [pps.length], // numOfPictureParameterSets
      pictureParameterSets // "PPS"
      ))), box(types.btrt, new Uint8Array([0x00, 0x1c, 0x9c, 0x80, // bufferSizeDB
      0x00, 0x2d, 0xc6, 0xc0, // maxBitrate
      0x00, 0x2d, 0xc6, 0xc0 // avgBitrate
      ]))];

      if (track.sarRatio) {
        var hSpacing = track.sarRatio[0],
            vSpacing = track.sarRatio[1];
        avc1Box.push(box(types.pasp, new Uint8Array([(hSpacing & 0xFF000000) >> 24, (hSpacing & 0xFF0000) >> 16, (hSpacing & 0xFF00) >> 8, hSpacing & 0xFF, (vSpacing & 0xFF000000) >> 24, (vSpacing & 0xFF0000) >> 16, (vSpacing & 0xFF00) >> 8, vSpacing & 0xFF])));
      }

      return box.apply(null, avc1Box);
    };

    audioSample = function audioSample(track) {
      return box(types.mp4a, new Uint8Array([// SampleEntry, ISO/IEC 14496-12
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data_reference_index
      // AudioSampleEntry, ISO/IEC 14496-12
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      (track.channelcount & 0xff00) >> 8, track.channelcount & 0xff, // channelcount
      (track.samplesize & 0xff00) >> 8, track.samplesize & 0xff, // samplesize
      0x00, 0x00, // pre_defined
      0x00, 0x00, // reserved
      (track.samplerate & 0xff00) >> 8, track.samplerate & 0xff, 0x00, 0x00 // samplerate, 16.16
      // MP4AudioSampleEntry, ISO/IEC 14496-14
      ]), esds(track));
    };
  })();

  tkhd = function tkhd(track) {
    var result = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x07, // flags
    0x00, 0x00, 0x00, 0x00, // creation_time
    0x00, 0x00, 0x00, 0x00, // modification_time
    (track.id & 0xFF000000) >> 24, (track.id & 0xFF0000) >> 16, (track.id & 0xFF00) >> 8, track.id & 0xFF, // track_ID
    0x00, 0x00, 0x00, 0x00, // reserved
    (track.duration & 0xFF000000) >> 24, (track.duration & 0xFF0000) >> 16, (track.duration & 0xFF00) >> 8, track.duration & 0xFF, // duration
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, // layer
    0x00, 0x00, // alternate_group
    0x01, 0x00, // non-audio track volume
    0x00, 0x00, // reserved
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
    (track.width & 0xFF00) >> 8, track.width & 0xFF, 0x00, 0x00, // width
    (track.height & 0xFF00) >> 8, track.height & 0xFF, 0x00, 0x00 // height
    ]);
    return box(types.tkhd, result);
  };
  /**
   * Generate a track fragment (traf) box. A traf box collects metadata
   * about tracks in a movie fragment (moof) box.
   */


  traf = function traf(track) {
    var trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable, dataOffset, upperWordBaseMediaDecodeTime, lowerWordBaseMediaDecodeTime;
    trackFragmentHeader = box(types.tfhd, new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x3a, // flags
    (track.id & 0xFF000000) >> 24, (track.id & 0xFF0000) >> 16, (track.id & 0xFF00) >> 8, track.id & 0xFF, // track_ID
    0x00, 0x00, 0x00, 0x01, // sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x00, 0x00, 0x00 // default_sample_flags
    ]));
    upperWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime / MAX_UINT32);
    lowerWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime % MAX_UINT32);
    trackFragmentDecodeTime = box(types.tfdt, new Uint8Array([0x01, // version 1
    0x00, 0x00, 0x00, // flags
    // baseMediaDecodeTime
    upperWordBaseMediaDecodeTime >>> 24 & 0xFF, upperWordBaseMediaDecodeTime >>> 16 & 0xFF, upperWordBaseMediaDecodeTime >>> 8 & 0xFF, upperWordBaseMediaDecodeTime & 0xFF, lowerWordBaseMediaDecodeTime >>> 24 & 0xFF, lowerWordBaseMediaDecodeTime >>> 16 & 0xFF, lowerWordBaseMediaDecodeTime >>> 8 & 0xFF, lowerWordBaseMediaDecodeTime & 0xFF])); // the data offset specifies the number of bytes from the start of
    // the containing moof to the first payload byte of the associated
    // mdat

    dataOffset = 32 + // tfhd
    20 + // tfdt
    8 + // traf header
    16 + // mfhd
    8 + // moof header
    8; // mdat header
    // audio tracks require less metadata

    if (track.type === 'audio') {
      trackFragmentRun = trun$1(track, dataOffset);
      return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun);
    } // video tracks should contain an independent and disposable samples
    // box (sdtp)
    // generate one and adjust offsets to match


    sampleDependencyTable = sdtp(track);
    trackFragmentRun = trun$1(track, sampleDependencyTable.length + dataOffset);
    return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable);
  };
  /**
   * Generate a track box.
   * @param track {object} a track definition
   * @return {Uint8Array} the track box
   */


  trak = function trak(track) {
    track.duration = track.duration || 0xffffffff;
    return box(types.trak, tkhd(track), mdia(track));
  };

  trex = function trex(track) {
    var result = new Uint8Array([0x00, // version 0
    0x00, 0x00, 0x00, // flags
    (track.id & 0xFF000000) >> 24, (track.id & 0xFF0000) >> 16, (track.id & 0xFF00) >> 8, track.id & 0xFF, // track_ID
    0x00, 0x00, 0x00, 0x01, // default_sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x01, 0x00, 0x01 // default_sample_flags
    ]); // the last two bytes of default_sample_flags is the sample
    // degradation priority, a hint about the importance of this sample
    // relative to others. Lower the degradation priority for all sample
    // types other than video.

    if (track.type !== 'video') {
      result[result.length - 1] = 0x00;
    }

    return box(types.trex, result);
  };

  (function () {
    var audioTrun, videoTrun, trunHeader; // This method assumes all samples are uniform. That is, if a
    // duration is present for the first sample, it will be present for
    // all subsequent samples.
    // see ISO/IEC 14496-12:2012, Section 8.8.8.1

    trunHeader = function trunHeader(samples, offset) {
      var durationPresent = 0,
          sizePresent = 0,
          flagsPresent = 0,
          compositionTimeOffset = 0; // trun flag constants

      if (samples.length) {
        if (samples[0].duration !== undefined) {
          durationPresent = 0x1;
        }

        if (samples[0].size !== undefined) {
          sizePresent = 0x2;
        }

        if (samples[0].flags !== undefined) {
          flagsPresent = 0x4;
        }

        if (samples[0].compositionTimeOffset !== undefined) {
          compositionTimeOffset = 0x8;
        }
      }

      return [0x00, // version 0
      0x00, durationPresent | sizePresent | flagsPresent | compositionTimeOffset, 0x01, // flags
      (samples.length & 0xFF000000) >>> 24, (samples.length & 0xFF0000) >>> 16, (samples.length & 0xFF00) >>> 8, samples.length & 0xFF, // sample_count
      (offset & 0xFF000000) >>> 24, (offset & 0xFF0000) >>> 16, (offset & 0xFF00) >>> 8, offset & 0xFF // data_offset
      ];
    };

    videoTrun = function videoTrun(track, offset) {
      var bytesOffest, bytes, header, samples, sample, i;
      samples = track.samples || [];
      offset += 8 + 12 + 16 * samples.length;
      header = trunHeader(samples, offset);
      bytes = new Uint8Array(header.length + samples.length * 16);
      bytes.set(header);
      bytesOffest = header.length;

      for (i = 0; i < samples.length; i++) {
        sample = samples[i];
        bytes[bytesOffest++] = (sample.duration & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.duration & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.duration & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.duration & 0xFF; // sample_duration

        bytes[bytesOffest++] = (sample.size & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.size & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.size & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.size & 0xFF; // sample_size

        bytes[bytesOffest++] = sample.flags.isLeading << 2 | sample.flags.dependsOn;
        bytes[bytesOffest++] = sample.flags.isDependedOn << 6 | sample.flags.hasRedundancy << 4 | sample.flags.paddingValue << 1 | sample.flags.isNonSyncSample;
        bytes[bytesOffest++] = sample.flags.degradationPriority & 0xF0 << 8;
        bytes[bytesOffest++] = sample.flags.degradationPriority & 0x0F; // sample_flags

        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.compositionTimeOffset & 0xFF; // sample_composition_time_offset
      }

      return box(types.trun, bytes);
    };

    audioTrun = function audioTrun(track, offset) {
      var bytes, bytesOffest, header, samples, sample, i;
      samples = track.samples || [];
      offset += 8 + 12 + 8 * samples.length;
      header = trunHeader(samples, offset);
      bytes = new Uint8Array(header.length + samples.length * 8);
      bytes.set(header);
      bytesOffest = header.length;

      for (i = 0; i < samples.length; i++) {
        sample = samples[i];
        bytes[bytesOffest++] = (sample.duration & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.duration & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.duration & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.duration & 0xFF; // sample_duration

        bytes[bytesOffest++] = (sample.size & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.size & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.size & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.size & 0xFF; // sample_size
      }

      return box(types.trun, bytes);
    };

    trun$1 = function trun(track, offset) {
      if (track.type === 'audio') {
        return audioTrun(track, offset);
      }

      return videoTrun(track, offset);
    };
  })();

  var mp4Generator = {
    ftyp: ftyp,
    mdat: mdat,
    moof: moof,
    moov: moov,
    initSegment: function initSegment(tracks) {
      var fileType = ftyp(),
          movie = moov(tracks),
          result;
      result = new Uint8Array(fileType.byteLength + movie.byteLength);
      result.set(fileType);
      result.set(movie, fileType.byteLength);
      return result;
    }
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  // Convert an array of nal units into an array of frames with each frame being
  // composed of the nal units that make up that frame
  // Also keep track of cummulative data about the frame from the nal units such
  // as the frame duration, starting pts, etc.

  var groupNalsIntoFrames = function groupNalsIntoFrames(nalUnits) {
    var i,
        currentNal,
        currentFrame = [],
        frames = []; // TODO added for LHLS, make sure this is OK

    frames.byteLength = 0;
    frames.nalCount = 0;
    frames.duration = 0;
    currentFrame.byteLength = 0;

    for (i = 0; i < nalUnits.length; i++) {
      currentNal = nalUnits[i]; // Split on 'aud'-type nal units

      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        // Since the very first nal unit is expected to be an AUD
        // only push to the frames array when currentFrame is not empty
        if (currentFrame.length) {
          currentFrame.duration = currentNal.dts - currentFrame.dts; // TODO added for LHLS, make sure this is OK

          frames.byteLength += currentFrame.byteLength;
          frames.nalCount += currentFrame.length;
          frames.duration += currentFrame.duration;
          frames.push(currentFrame);
        }

        currentFrame = [currentNal];
        currentFrame.byteLength = currentNal.data.byteLength;
        currentFrame.pts = currentNal.pts;
        currentFrame.dts = currentNal.dts;
      } else {
        // Specifically flag key frames for ease of use later
        if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
          currentFrame.keyFrame = true;
        }

        currentFrame.duration = currentNal.dts - currentFrame.dts;
        currentFrame.byteLength += currentNal.data.byteLength;
        currentFrame.push(currentNal);
      }
    } // For the last frame, use the duration of the previous frame if we
    // have nothing better to go on


    if (frames.length && (!currentFrame.duration || currentFrame.duration <= 0)) {
      currentFrame.duration = frames[frames.length - 1].duration;
    } // Push the final frame
    // TODO added for LHLS, make sure this is OK


    frames.byteLength += currentFrame.byteLength;
    frames.nalCount += currentFrame.length;
    frames.duration += currentFrame.duration;
    frames.push(currentFrame);
    return frames;
  }; // Convert an array of frames into an array of Gop with each Gop being composed
  // of the frames that make up that Gop
  // Also keep track of cummulative data about the Gop from the frames such as the
  // Gop duration, starting pts, etc.


  var groupFramesIntoGops = function groupFramesIntoGops(frames) {
    var i,
        currentFrame,
        currentGop = [],
        gops = []; // We must pre-set some of the values on the Gop since we
    // keep running totals of these values

    currentGop.byteLength = 0;
    currentGop.nalCount = 0;
    currentGop.duration = 0;
    currentGop.pts = frames[0].pts;
    currentGop.dts = frames[0].dts; // store some metadata about all the Gops

    gops.byteLength = 0;
    gops.nalCount = 0;
    gops.duration = 0;
    gops.pts = frames[0].pts;
    gops.dts = frames[0].dts;

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      if (currentFrame.keyFrame) {
        // Since the very first frame is expected to be an keyframe
        // only push to the gops array when currentGop is not empty
        if (currentGop.length) {
          gops.push(currentGop);
          gops.byteLength += currentGop.byteLength;
          gops.nalCount += currentGop.nalCount;
          gops.duration += currentGop.duration;
        }

        currentGop = [currentFrame];
        currentGop.nalCount = currentFrame.length;
        currentGop.byteLength = currentFrame.byteLength;
        currentGop.pts = currentFrame.pts;
        currentGop.dts = currentFrame.dts;
        currentGop.duration = currentFrame.duration;
      } else {
        currentGop.duration += currentFrame.duration;
        currentGop.nalCount += currentFrame.length;
        currentGop.byteLength += currentFrame.byteLength;
        currentGop.push(currentFrame);
      }
    }

    if (gops.length && currentGop.duration <= 0) {
      currentGop.duration = gops[gops.length - 1].duration;
    }

    gops.byteLength += currentGop.byteLength;
    gops.nalCount += currentGop.nalCount;
    gops.duration += currentGop.duration; // push the final Gop

    gops.push(currentGop);
    return gops;
  };
  /*
   * Search for the first keyframe in the GOPs and throw away all frames
   * until that keyframe. Then extend the duration of the pulled keyframe
   * and pull the PTS and DTS of the keyframe so that it covers the time
   * range of the frames that were disposed.
   *
   * @param {Array} gops video GOPs
   * @returns {Array} modified video GOPs
   */


  var extendFirstKeyFrame = function extendFirstKeyFrame(gops) {
    var currentGop;

    if (!gops[0][0].keyFrame && gops.length > 1) {
      // Remove the first GOP
      currentGop = gops.shift();
      gops.byteLength -= currentGop.byteLength;
      gops.nalCount -= currentGop.nalCount; // Extend the first frame of what is now the
      // first gop to cover the time period of the
      // frames we just removed

      gops[0][0].dts = currentGop.dts;
      gops[0][0].pts = currentGop.pts;
      gops[0][0].duration += currentGop.duration;
    }

    return gops;
  };
  /**
   * Default sample object
   * see ISO/IEC 14496-12:2012, section 8.6.4.3
   */


  var createDefaultSample = function createDefaultSample() {
    return {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0,
        isNonSyncSample: 1
      }
    };
  };
  /*
   * Collates information from a video frame into an object for eventual
   * entry into an MP4 sample table.
   *
   * @param {Object} frame the video frame
   * @param {Number} dataOffset the byte offset to position the sample
   * @return {Object} object containing sample table info for a frame
   */


  var sampleForFrame = function sampleForFrame(frame, dataOffset) {
    var sample = createDefaultSample();
    sample.dataOffset = dataOffset;
    sample.compositionTimeOffset = frame.pts - frame.dts;
    sample.duration = frame.duration;
    sample.size = 4 * frame.length; // Space for nal unit size

    sample.size += frame.byteLength;

    if (frame.keyFrame) {
      sample.flags.dependsOn = 2;
      sample.flags.isNonSyncSample = 0;
    }

    return sample;
  }; // generate the track's sample table from an array of gops


  var generateSampleTable$1 = function generateSampleTable(gops, baseDataOffset) {
    var h,
        i,
        sample,
        currentGop,
        currentFrame,
        dataOffset = baseDataOffset || 0,
        samples = [];

    for (h = 0; h < gops.length; h++) {
      currentGop = gops[h];

      for (i = 0; i < currentGop.length; i++) {
        currentFrame = currentGop[i];
        sample = sampleForFrame(currentFrame, dataOffset);
        dataOffset += sample.size;
        samples.push(sample);
      }
    }

    return samples;
  }; // generate the track's raw mdat data from an array of gops


  var concatenateNalData = function concatenateNalData(gops) {
    var h,
        i,
        j,
        currentGop,
        currentFrame,
        currentNal,
        dataOffset = 0,
        nalsByteLength = gops.byteLength,
        numberOfNals = gops.nalCount,
        totalByteLength = nalsByteLength + 4 * numberOfNals,
        data = new Uint8Array(totalByteLength),
        view = new DataView(data.buffer); // For each Gop..

    for (h = 0; h < gops.length; h++) {
      currentGop = gops[h]; // For each Frame..

      for (i = 0; i < currentGop.length; i++) {
        currentFrame = currentGop[i]; // For each NAL..

        for (j = 0; j < currentFrame.length; j++) {
          currentNal = currentFrame[j];
          view.setUint32(dataOffset, currentNal.data.byteLength);
          dataOffset += 4;
          data.set(currentNal.data, dataOffset);
          dataOffset += currentNal.data.byteLength;
        }
      }
    }

    return data;
  }; // generate the track's sample table from a frame


  var generateSampleTableForFrame = function generateSampleTableForFrame(frame, baseDataOffset) {
    var sample,
        dataOffset = baseDataOffset || 0,
        samples = [];
    sample = sampleForFrame(frame, dataOffset);
    samples.push(sample);
    return samples;
  }; // generate the track's raw mdat data from a frame


  var concatenateNalDataForFrame = function concatenateNalDataForFrame(frame) {
    var i,
        currentNal,
        dataOffset = 0,
        nalsByteLength = frame.byteLength,
        numberOfNals = frame.length,
        totalByteLength = nalsByteLength + 4 * numberOfNals,
        data = new Uint8Array(totalByteLength),
        view = new DataView(data.buffer); // For each NAL..

    for (i = 0; i < frame.length; i++) {
      currentNal = frame[i];
      view.setUint32(dataOffset, currentNal.data.byteLength);
      dataOffset += 4;
      data.set(currentNal.data, dataOffset);
      dataOffset += currentNal.data.byteLength;
    }

    return data;
  };

  var frameUtils = {
    groupNalsIntoFrames: groupNalsIntoFrames,
    groupFramesIntoGops: groupFramesIntoGops,
    extendFirstKeyFrame: extendFirstKeyFrame,
    generateSampleTable: generateSampleTable$1,
    concatenateNalData: concatenateNalData,
    generateSampleTableForFrame: generateSampleTableForFrame,
    concatenateNalDataForFrame: concatenateNalDataForFrame
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var highPrefix = [33, 16, 5, 32, 164, 27];
  var lowPrefix = [33, 65, 108, 84, 1, 2, 4, 8, 168, 2, 4, 8, 17, 191, 252];

  var zeroFill = function zeroFill(count) {
    var a = [];

    while (count--) {
      a.push(0);
    }

    return a;
  };

  var makeTable = function makeTable(metaTable) {
    return Object.keys(metaTable).reduce(function (obj, key) {
      obj[key] = new Uint8Array(metaTable[key].reduce(function (arr, part) {
        return arr.concat(part);
      }, []));
      return obj;
    }, {});
  };

  var silence;

  var silence_1 = function silence_1() {
    if (!silence) {
      // Frames-of-silence to use for filling in missing AAC frames
      var coneOfSilence = {
        96000: [highPrefix, [227, 64], zeroFill(154), [56]],
        88200: [highPrefix, [231], zeroFill(170), [56]],
        64000: [highPrefix, [248, 192], zeroFill(240), [56]],
        48000: [highPrefix, [255, 192], zeroFill(268), [55, 148, 128], zeroFill(54), [112]],
        44100: [highPrefix, [255, 192], zeroFill(268), [55, 163, 128], zeroFill(84), [112]],
        32000: [highPrefix, [255, 192], zeroFill(268), [55, 234], zeroFill(226), [112]],
        24000: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 112], zeroFill(126), [224]],
        16000: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 255], zeroFill(269), [223, 108], zeroFill(195), [1, 192]],
        12000: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 253, 128], zeroFill(259), [56]],
        11025: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 255, 192], zeroFill(268), [55, 175, 128], zeroFill(108), [112]],
        8000: [lowPrefix, zeroFill(268), [3, 121, 16], zeroFill(47), [7]]
      };
      silence = makeTable(coneOfSilence);
    }

    return silence;
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */


  var ONE_SECOND_IN_TS$4 = 90000,
      // 90kHz clock
  secondsToVideoTs,
      secondsToAudioTs,
      videoTsToSeconds,
      audioTsToSeconds,
      audioTsToVideoTs,
      videoTsToAudioTs,
      metadataTsToSeconds;

  secondsToVideoTs = function secondsToVideoTs(seconds) {
    return seconds * ONE_SECOND_IN_TS$4;
  };

  secondsToAudioTs = function secondsToAudioTs(seconds, sampleRate) {
    return seconds * sampleRate;
  };

  videoTsToSeconds = function videoTsToSeconds(timestamp) {
    return timestamp / ONE_SECOND_IN_TS$4;
  };

  audioTsToSeconds = function audioTsToSeconds(timestamp, sampleRate) {
    return timestamp / sampleRate;
  };

  audioTsToVideoTs = function audioTsToVideoTs(timestamp, sampleRate) {
    return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
  };

  videoTsToAudioTs = function videoTsToAudioTs(timestamp, sampleRate) {
    return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
  };
  /**
   * Adjust ID3 tag or caption timing information by the timeline pts values
   * (if keepOriginalTimestamps is false) and convert to seconds
   */


  metadataTsToSeconds = function metadataTsToSeconds(timestamp, timelineStartPts, keepOriginalTimestamps) {
    return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
  };

  var clock = {
    ONE_SECOND_IN_TS: ONE_SECOND_IN_TS$4,
    secondsToVideoTs: secondsToVideoTs,
    secondsToAudioTs: secondsToAudioTs,
    videoTsToSeconds: videoTsToSeconds,
    audioTsToSeconds: audioTsToSeconds,
    audioTsToVideoTs: audioTsToVideoTs,
    videoTsToAudioTs: videoTsToAudioTs,
    metadataTsToSeconds: metadataTsToSeconds
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  /**
   * Sum the `byteLength` properties of the data in each AAC frame
   */

  var sumFrameByteLengths = function sumFrameByteLengths(array) {
    var i,
        currentObj,
        sum = 0; // sum the byteLength's all each nal unit in the frame

    for (i = 0; i < array.length; i++) {
      currentObj = array[i];
      sum += currentObj.data.byteLength;
    }

    return sum;
  }; // Possibly pad (prefix) the audio track with silence if appending this track
  // would lead to the introduction of a gap in the audio buffer


  var prefixWithSilence = function prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime) {
    var baseMediaDecodeTimeTs,
        frameDuration = 0,
        audioGapDuration = 0,
        audioFillFrameCount = 0,
        audioFillDuration = 0,
        silentFrame,
        i,
        firstFrame;

    if (!frames.length) {
      return;
    }

    baseMediaDecodeTimeTs = clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate); // determine frame clock duration based on sample rate, round up to avoid overfills

    frameDuration = Math.ceil(clock.ONE_SECOND_IN_TS / (track.samplerate / 1024));

    if (audioAppendStartTs && videoBaseMediaDecodeTime) {
      // insert the shortest possible amount (audio gap or audio to video gap)
      audioGapDuration = baseMediaDecodeTimeTs - Math.max(audioAppendStartTs, videoBaseMediaDecodeTime); // number of full frames in the audio gap

      audioFillFrameCount = Math.floor(audioGapDuration / frameDuration);
      audioFillDuration = audioFillFrameCount * frameDuration;
    } // don't attempt to fill gaps smaller than a single frame or larger
    // than a half second


    if (audioFillFrameCount < 1 || audioFillDuration > clock.ONE_SECOND_IN_TS / 2) {
      return;
    }

    silentFrame = silence_1()[track.samplerate];

    if (!silentFrame) {
      // we don't have a silent frame pregenerated for the sample rate, so use a frame
      // from the content instead
      silentFrame = frames[0].data;
    }

    for (i = 0; i < audioFillFrameCount; i++) {
      firstFrame = frames[0];
      frames.splice(0, 0, {
        data: silentFrame,
        dts: firstFrame.dts - frameDuration,
        pts: firstFrame.pts - frameDuration
      });
    }

    track.baseMediaDecodeTime -= Math.floor(clock.videoTsToAudioTs(audioFillDuration, track.samplerate));
    return audioFillDuration;
  }; // If the audio segment extends before the earliest allowed dts
  // value, remove AAC frames until starts at or after the earliest
  // allowed DTS so that we don't end up with a negative baseMedia-
  // DecodeTime for the audio track


  var trimAdtsFramesByEarliestDts = function trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts) {
    if (track.minSegmentDts >= earliestAllowedDts) {
      return adtsFrames;
    } // We will need to recalculate the earliest segment Dts


    track.minSegmentDts = Infinity;
    return adtsFrames.filter(function (currentFrame) {
      // If this is an allowed frame, keep it and record it's Dts
      if (currentFrame.dts >= earliestAllowedDts) {
        track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
        track.minSegmentPts = track.minSegmentDts;
        return true;
      } // Otherwise, discard it


      return false;
    });
  }; // generate the track's raw mdat data from an array of frames


  var generateSampleTable = function generateSampleTable(frames) {
    var i,
        currentFrame,
        samples = [];

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];
      samples.push({
        size: currentFrame.data.byteLength,
        duration: 1024 // For AAC audio, all samples contain 1024 samples

      });
    }

    return samples;
  }; // generate the track's sample table from an array of frames


  var concatenateFrameData = function concatenateFrameData(frames) {
    var i,
        currentFrame,
        dataOffset = 0,
        data = new Uint8Array(sumFrameByteLengths(frames));

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];
      data.set(currentFrame.data, dataOffset);
      dataOffset += currentFrame.data.byteLength;
    }

    return data;
  };

  var audioFrameUtils = {
    prefixWithSilence: prefixWithSilence,
    trimAdtsFramesByEarliestDts: trimAdtsFramesByEarliestDts,
    generateSampleTable: generateSampleTable,
    concatenateFrameData: concatenateFrameData
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var ONE_SECOND_IN_TS$3 = clock.ONE_SECOND_IN_TS;
  /**
   * Store information about the start and end of the track and the
   * duration for each frame/sample we process in order to calculate
   * the baseMediaDecodeTime
   */

  var collectDtsInfo = function collectDtsInfo(track, data) {
    if (typeof data.pts === 'number') {
      if (track.timelineStartInfo.pts === undefined) {
        track.timelineStartInfo.pts = data.pts;
      }

      if (track.minSegmentPts === undefined) {
        track.minSegmentPts = data.pts;
      } else {
        track.minSegmentPts = Math.min(track.minSegmentPts, data.pts);
      }

      if (track.maxSegmentPts === undefined) {
        track.maxSegmentPts = data.pts;
      } else {
        track.maxSegmentPts = Math.max(track.maxSegmentPts, data.pts);
      }
    }

    if (typeof data.dts === 'number') {
      if (track.timelineStartInfo.dts === undefined) {
        track.timelineStartInfo.dts = data.dts;
      }

      if (track.minSegmentDts === undefined) {
        track.minSegmentDts = data.dts;
      } else {
        track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
      }

      if (track.maxSegmentDts === undefined) {
        track.maxSegmentDts = data.dts;
      } else {
        track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
      }
    }
  };
  /**
   * Clear values used to calculate the baseMediaDecodeTime between
   * tracks
   */


  var clearDtsInfo = function clearDtsInfo(track) {
    delete track.minSegmentDts;
    delete track.maxSegmentDts;
    delete track.minSegmentPts;
    delete track.maxSegmentPts;
  };
  /**
   * Calculate the track's baseMediaDecodeTime based on the earliest
   * DTS the transmuxer has ever seen and the minimum DTS for the
   * current track
   * @param track {object} track metadata configuration
   * @param keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */


  var calculateTrackBaseMediaDecodeTime = function calculateTrackBaseMediaDecodeTime(track, keepOriginalTimestamps) {
    var baseMediaDecodeTime,
        scale,
        minSegmentDts = track.minSegmentDts; // Optionally adjust the time so the first segment starts at zero.

    if (!keepOriginalTimestamps) {
      minSegmentDts -= track.timelineStartInfo.dts;
    } // track.timelineStartInfo.baseMediaDecodeTime is the location, in time, where
    // we want the start of the first segment to be placed


    baseMediaDecodeTime = track.timelineStartInfo.baseMediaDecodeTime; // Add to that the distance this segment is from the very first

    baseMediaDecodeTime += minSegmentDts; // baseMediaDecodeTime must not become negative

    baseMediaDecodeTime = Math.max(0, baseMediaDecodeTime);

    if (track.type === 'audio') {
      // Audio has a different clock equal to the sampling_rate so we need to
      // scale the PTS values into the clock rate of the track
      scale = track.samplerate / ONE_SECOND_IN_TS$3;
      baseMediaDecodeTime *= scale;
      baseMediaDecodeTime = Math.floor(baseMediaDecodeTime);
    }

    return baseMediaDecodeTime;
  };

  var trackDecodeInfo = {
    clearDtsInfo: clearDtsInfo,
    calculateTrackBaseMediaDecodeTime: calculateTrackBaseMediaDecodeTime,
    collectDtsInfo: collectDtsInfo
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * Reads in-band caption information from a video elementary
   * stream. Captions must follow the CEA-708 standard for injection
   * into an MPEG-2 transport streams.
   * @see https://en.wikipedia.org/wiki/CEA-708
   * @see https://www.gpo.gov/fdsys/pkg/CFR-2007-title47-vol1/pdf/CFR-2007-title47-vol1-sec15-119.pdf
   */
  // payload type field to indicate how they are to be
  // interpreted. CEAS-708 caption content is always transmitted with
  // payload type 0x04.

  var USER_DATA_REGISTERED_ITU_T_T35 = 4,
      RBSP_TRAILING_BITS = 128;
  /**
    * Parse a supplemental enhancement information (SEI) NAL unit.
    * Stops parsing once a message of type ITU T T35 has been found.
    *
    * @param bytes {Uint8Array} the bytes of a SEI NAL unit
    * @return {object} the parsed SEI payload
    * @see Rec. ITU-T H.264, 7.3.2.3.1
    */

  var parseSei = function parseSei(bytes) {
    var i = 0,
        result = {
      payloadType: -1,
      payloadSize: 0
    },
        payloadType = 0,
        payloadSize = 0; // go through the sei_rbsp parsing each each individual sei_message

    while (i < bytes.byteLength) {
      // stop once we have hit the end of the sei_rbsp
      if (bytes[i] === RBSP_TRAILING_BITS) {
        break;
      } // Parse payload type


      while (bytes[i] === 0xFF) {
        payloadType += 255;
        i++;
      }

      payloadType += bytes[i++]; // Parse payload size

      while (bytes[i] === 0xFF) {
        payloadSize += 255;
        i++;
      }

      payloadSize += bytes[i++]; // this sei_message is a 608/708 caption so save it and break
      // there can only ever be one caption message in a frame's sei

      if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
        var userIdentifier = String.fromCharCode(bytes[i + 3], bytes[i + 4], bytes[i + 5], bytes[i + 6]);

        if (userIdentifier === 'GA94') {
          result.payloadType = payloadType;
          result.payloadSize = payloadSize;
          result.payload = bytes.subarray(i, i + payloadSize);
          break;
        } else {
          result.payload = void 0;
        }
      } // skip the payload and parse the next message


      i += payloadSize;
      payloadType = 0;
      payloadSize = 0;
    }

    return result;
  }; // see ANSI/SCTE 128-1 (2013), section 8.1


  var parseUserData = function parseUserData(sei) {
    // itu_t_t35_contry_code must be 181 (United States) for
    // captions
    if (sei.payload[0] !== 181) {
      return null;
    } // itu_t_t35_provider_code should be 49 (ATSC) for captions


    if ((sei.payload[1] << 8 | sei.payload[2]) !== 49) {
      return null;
    } // the user_identifier should be "GA94" to indicate ATSC1 data


    if (String.fromCharCode(sei.payload[3], sei.payload[4], sei.payload[5], sei.payload[6]) !== 'GA94') {
      return null;
    } // finally, user_data_type_code should be 0x03 for caption data


    if (sei.payload[7] !== 0x03) {
      return null;
    } // return the user_data_type_structure and strip the trailing
    // marker bits


    return sei.payload.subarray(8, sei.payload.length - 1);
  }; // see CEA-708-D, section 4.4


  var parseCaptionPackets = function parseCaptionPackets(pts, userData) {
    var results = [],
        i,
        count,
        offset,
        data; // if this is just filler, return immediately

    if (!(userData[0] & 0x40)) {
      return results;
    } // parse out the cc_data_1 and cc_data_2 fields


    count = userData[0] & 0x1f;

    for (i = 0; i < count; i++) {
      offset = i * 3;
      data = {
        type: userData[offset + 2] & 0x03,
        pts: pts
      }; // capture cc data when cc_valid is 1

      if (userData[offset + 2] & 0x04) {
        data.ccData = userData[offset + 3] << 8 | userData[offset + 4];
        results.push(data);
      }
    }

    return results;
  };

  var discardEmulationPreventionBytes$1 = function discardEmulationPreventionBytes(data) {
    var length = data.byteLength,
        emulationPreventionBytesPositions = [],
        i = 1,
        newLength,
        newData; // Find all `Emulation Prevention Bytes`

    while (i < length - 2) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
        emulationPreventionBytesPositions.push(i + 2);
        i += 2;
      } else {
        i++;
      }
    } // If no Emulation Prevention Bytes were found just return the original
    // array


    if (emulationPreventionBytesPositions.length === 0) {
      return data;
    } // Create a new array to hold the NAL unit data


    newLength = length - emulationPreventionBytesPositions.length;
    newData = new Uint8Array(newLength);
    var sourceIndex = 0;

    for (i = 0; i < newLength; sourceIndex++, i++) {
      if (sourceIndex === emulationPreventionBytesPositions[0]) {
        // Skip this byte
        sourceIndex++; // Remove this position index

        emulationPreventionBytesPositions.shift();
      }

      newData[i] = data[sourceIndex];
    }

    return newData;
  }; // exports


  var captionPacketParser = {
    parseSei: parseSei,
    parseUserData: parseUserData,
    parseCaptionPackets: parseCaptionPackets,
    discardEmulationPreventionBytes: discardEmulationPreventionBytes$1,
    USER_DATA_REGISTERED_ITU_T_T35: USER_DATA_REGISTERED_ITU_T_T35
  }; // Link To Transport
  // -----------------

  var CaptionStream$1 = function CaptionStream(options) {
    options = options || {};
    CaptionStream.prototype.init.call(this); // parse708captions flag, default to true

    this.parse708captions_ = typeof options.parse708captions === 'boolean' ? options.parse708captions : true;
    this.captionPackets_ = [];
    this.ccStreams_ = [new Cea608Stream(0, 0), // eslint-disable-line no-use-before-define
    new Cea608Stream(0, 1), // eslint-disable-line no-use-before-define
    new Cea608Stream(1, 0), // eslint-disable-line no-use-before-define
    new Cea608Stream(1, 1) // eslint-disable-line no-use-before-define
    ];

    if (this.parse708captions_) {
      this.cc708Stream_ = new Cea708Stream({
        captionServices: options.captionServices
      }); // eslint-disable-line no-use-before-define
    }

    this.reset(); // forward data and done events from CCs to this CaptionStream

    this.ccStreams_.forEach(function (cc) {
      cc.on('data', this.trigger.bind(this, 'data'));
      cc.on('partialdone', this.trigger.bind(this, 'partialdone'));
      cc.on('done', this.trigger.bind(this, 'done'));
    }, this);

    if (this.parse708captions_) {
      this.cc708Stream_.on('data', this.trigger.bind(this, 'data'));
      this.cc708Stream_.on('partialdone', this.trigger.bind(this, 'partialdone'));
      this.cc708Stream_.on('done', this.trigger.bind(this, 'done'));
    }
  };

  CaptionStream$1.prototype = new stream();

  CaptionStream$1.prototype.push = function (event) {
    var sei, userData, newCaptionPackets; // only examine SEI NALs

    if (event.nalUnitType !== 'sei_rbsp') {
      return;
    } // parse the sei


    sei = captionPacketParser.parseSei(event.escapedRBSP); // no payload data, skip

    if (!sei.payload) {
      return;
    } // ignore everything but user_data_registered_itu_t_t35


    if (sei.payloadType !== captionPacketParser.USER_DATA_REGISTERED_ITU_T_T35) {
      return;
    } // parse out the user data payload


    userData = captionPacketParser.parseUserData(sei); // ignore unrecognized userData

    if (!userData) {
      return;
    } // Sometimes, the same segment # will be downloaded twice. To stop the
    // caption data from being processed twice, we track the latest dts we've
    // received and ignore everything with a dts before that. However, since
    // data for a specific dts can be split across packets on either side of
    // a segment boundary, we need to make sure we *don't* ignore the packets
    // from the *next* segment that have dts === this.latestDts_. By constantly
    // tracking the number of packets received with dts === this.latestDts_, we
    // know how many should be ignored once we start receiving duplicates.


    if (event.dts < this.latestDts_) {
      // We've started getting older data, so set the flag.
      this.ignoreNextEqualDts_ = true;
      return;
    } else if (event.dts === this.latestDts_ && this.ignoreNextEqualDts_) {
      this.numSameDts_--;

      if (!this.numSameDts_) {
        // We've received the last duplicate packet, time to start processing again
        this.ignoreNextEqualDts_ = false;
      }

      return;
    } // parse out CC data packets and save them for later


    newCaptionPackets = captionPacketParser.parseCaptionPackets(event.pts, userData);
    this.captionPackets_ = this.captionPackets_.concat(newCaptionPackets);

    if (this.latestDts_ !== event.dts) {
      this.numSameDts_ = 0;
    }

    this.numSameDts_++;
    this.latestDts_ = event.dts;
  };

  CaptionStream$1.prototype.flushCCStreams = function (flushType) {
    this.ccStreams_.forEach(function (cc) {
      return flushType === 'flush' ? cc.flush() : cc.partialFlush();
    }, this);
  };

  CaptionStream$1.prototype.flushStream = function (flushType) {
    // make sure we actually parsed captions before proceeding
    if (!this.captionPackets_.length) {
      this.flushCCStreams(flushType);
      return;
    } // In Chrome, the Array#sort function is not stable so add a
    // presortIndex that we can use to ensure we get a stable-sort


    this.captionPackets_.forEach(function (elem, idx) {
      elem.presortIndex = idx;
    }); // sort caption byte-pairs based on their PTS values

    this.captionPackets_.sort(function (a, b) {
      if (a.pts === b.pts) {
        return a.presortIndex - b.presortIndex;
      }

      return a.pts - b.pts;
    });
    this.captionPackets_.forEach(function (packet) {
      if (packet.type < 2) {
        // Dispatch packet to the right Cea608Stream
        this.dispatchCea608Packet(packet);
      } else {
        // Dispatch packet to the Cea708Stream
        this.dispatchCea708Packet(packet);
      }
    }, this);
    this.captionPackets_.length = 0;
    this.flushCCStreams(flushType);
  };

  CaptionStream$1.prototype.flush = function () {
    return this.flushStream('flush');
  }; // Only called if handling partial data


  CaptionStream$1.prototype.partialFlush = function () {
    return this.flushStream('partialFlush');
  };

  CaptionStream$1.prototype.reset = function () {
    this.latestDts_ = null;
    this.ignoreNextEqualDts_ = false;
    this.numSameDts_ = 0;
    this.activeCea608Channel_ = [null, null];
    this.ccStreams_.forEach(function (ccStream) {
      ccStream.reset();
    });
  }; // From the CEA-608 spec:

  /*
   * When XDS sub-packets are interleaved with other services, the end of each sub-packet shall be followed
   * by a control pair to change to a different service. When any of the control codes from 0x10 to 0x1F is
   * used to begin a control code pair, it indicates the return to captioning or Text data. The control code pair
   * and subsequent data should then be processed according to the FCC rules. It may be necessary for the
   * line 21 data encoder to automatically insert a control code pair (i.e. RCL, RU2, RU3, RU4, RDC, or RTD)
   * to switch to captioning or Text.
  */
  // With that in mind, we ignore any data between an XDS control code and a
  // subsequent closed-captioning control code.


  CaptionStream$1.prototype.dispatchCea608Packet = function (packet) {
    // NOTE: packet.type is the CEA608 field
    if (this.setsTextOrXDSActive(packet)) {
      this.activeCea608Channel_[packet.type] = null;
    } else if (this.setsChannel1Active(packet)) {
      this.activeCea608Channel_[packet.type] = 0;
    } else if (this.setsChannel2Active(packet)) {
      this.activeCea608Channel_[packet.type] = 1;
    }

    if (this.activeCea608Channel_[packet.type] === null) {
      // If we haven't received anything to set the active channel, or the
      // packets are Text/XDS data, discard the data; we don't want jumbled
      // captions
      return;
    }

    this.ccStreams_[(packet.type << 1) + this.activeCea608Channel_[packet.type]].push(packet);
  };

  CaptionStream$1.prototype.setsChannel1Active = function (packet) {
    return (packet.ccData & 0x7800) === 0x1000;
  };

  CaptionStream$1.prototype.setsChannel2Active = function (packet) {
    return (packet.ccData & 0x7800) === 0x1800;
  };

  CaptionStream$1.prototype.setsTextOrXDSActive = function (packet) {
    return (packet.ccData & 0x7100) === 0x0100 || (packet.ccData & 0x78fe) === 0x102a || (packet.ccData & 0x78fe) === 0x182a;
  };

  CaptionStream$1.prototype.dispatchCea708Packet = function (packet) {
    if (this.parse708captions_) {
      this.cc708Stream_.push(packet);
    }
  }; // ----------------------
  // Session to Application
  // ----------------------
  // This hash maps special and extended character codes to their
  // proper Unicode equivalent. The first one-byte key is just a
  // non-standard character code. The two-byte keys that follow are
  // the extended CEA708 character codes, along with the preceding
  // 0x10 extended character byte to distinguish these codes from
  // non-extended character codes. Every CEA708 character code that
  // is not in this object maps directly to a standard unicode
  // character code.
  // The transparent space and non-breaking transparent space are
  // technically not fully supported since there is no code to
  // make them transparent, so they have normal non-transparent
  // stand-ins.
  // The special closed caption (CC) character isn't a standard
  // unicode character, so a fairly similar unicode character was
  // chosen in it's place.


  var CHARACTER_TRANSLATION_708 = {
    0x7f: 0x266a,
    // ♪
    0x1020: 0x20,
    // Transparent Space
    0x1021: 0xa0,
    // Nob-breaking Transparent Space
    0x1025: 0x2026,
    // …
    0x102a: 0x0160,
    // Š
    0x102c: 0x0152,
    // Œ
    0x1030: 0x2588,
    // █
    0x1031: 0x2018,
    // ‘
    0x1032: 0x2019,
    // ’
    0x1033: 0x201c,
    // “
    0x1034: 0x201d,
    // ”
    0x1035: 0x2022,
    // •
    0x1039: 0x2122,
    // ™
    0x103a: 0x0161,
    // š
    0x103c: 0x0153,
    // œ
    0x103d: 0x2120,
    // ℠
    0x103f: 0x0178,
    // Ÿ
    0x1076: 0x215b,
    // ⅛
    0x1077: 0x215c,
    // ⅜
    0x1078: 0x215d,
    // ⅝
    0x1079: 0x215e,
    // ⅞
    0x107a: 0x23d0,
    // ⏐
    0x107b: 0x23a4,
    // ⎤
    0x107c: 0x23a3,
    // ⎣
    0x107d: 0x23af,
    // ⎯
    0x107e: 0x23a6,
    // ⎦
    0x107f: 0x23a1,
    // ⎡
    0x10a0: 0x3138 // ㄸ (CC char)

  };

  var get708CharFromCode = function get708CharFromCode(code) {
    var newCode = CHARACTER_TRANSLATION_708[code] || code;

    if (code & 0x1000 && code === newCode) {
      // Invalid extended code
      return '';
    }

    return String.fromCharCode(newCode);
  };

  var within708TextBlock = function within708TextBlock(b) {
    return 0x20 <= b && b <= 0x7f || 0xa0 <= b && b <= 0xff;
  };

  var Cea708Window = function Cea708Window(windowNum) {
    this.windowNum = windowNum;
    this.reset();
  };

  Cea708Window.prototype.reset = function () {
    this.clearText();
    this.pendingNewLine = false;
    this.winAttr = {};
    this.penAttr = {};
    this.penLoc = {};
    this.penColor = {}; // These default values are arbitrary,
    // defineWindow will usually override them

    this.visible = 0;
    this.rowLock = 0;
    this.columnLock = 0;
    this.priority = 0;
    this.relativePositioning = 0;
    this.anchorVertical = 0;
    this.anchorHorizontal = 0;
    this.anchorPoint = 0;
    this.rowCount = 1;
    this.virtualRowCount = this.rowCount + 1;
    this.columnCount = 41;
    this.windowStyle = 0;
    this.penStyle = 0;
  };

  Cea708Window.prototype.getText = function () {
    return this.rows.join('\n');
  };

  Cea708Window.prototype.clearText = function () {
    this.rows = [''];
    this.rowIdx = 0;
  };

  Cea708Window.prototype.newLine = function (pts) {
    if (this.rows.length >= this.virtualRowCount && typeof this.beforeRowOverflow === 'function') {
      this.beforeRowOverflow(pts);
    }

    if (this.rows.length > 0) {
      this.rows.push('');
      this.rowIdx++;
    } // Show all virtual rows since there's no visible scrolling


    while (this.rows.length > this.virtualRowCount) {
      this.rows.shift();
      this.rowIdx--;
    }
  };

  Cea708Window.prototype.isEmpty = function () {
    if (this.rows.length === 0) {
      return true;
    } else if (this.rows.length === 1) {
      return this.rows[0] === '';
    }

    return false;
  };

  Cea708Window.prototype.addText = function (text) {
    this.rows[this.rowIdx] += text;
  };

  Cea708Window.prototype.backspace = function () {
    if (!this.isEmpty()) {
      var row = this.rows[this.rowIdx];
      this.rows[this.rowIdx] = row.substr(0, row.length - 1);
    }
  };

  var Cea708Service = function Cea708Service(serviceNum, encoding, stream) {
    this.serviceNum = serviceNum;
    this.text = '';
    this.currentWindow = new Cea708Window(-1);
    this.windows = [];
    this.stream = stream; // Try to setup a TextDecoder if an `encoding` value was provided

    if (typeof encoding === 'string') {
      this.createTextDecoder(encoding);
    }
  };
  /**
   * Initialize service windows
   * Must be run before service use
   *
   * @param  {Integer}  pts               PTS value
   * @param  {Function} beforeRowOverflow Function to execute before row overflow of a window
   */


  Cea708Service.prototype.init = function (pts, beforeRowOverflow) {
    this.startPts = pts;

    for (var win = 0; win < 8; win++) {
      this.windows[win] = new Cea708Window(win);

      if (typeof beforeRowOverflow === 'function') {
        this.windows[win].beforeRowOverflow = beforeRowOverflow;
      }
    }
  };
  /**
   * Set current window of service to be affected by commands
   *
   * @param  {Integer} windowNum Window number
   */


  Cea708Service.prototype.setCurrentWindow = function (windowNum) {
    this.currentWindow = this.windows[windowNum];
  };
  /**
   * Try to create a TextDecoder if it is natively supported
   */


  Cea708Service.prototype.createTextDecoder = function (encoding) {
    if (typeof TextDecoder === 'undefined') {
      this.stream.trigger('log', {
        level: 'warn',
        message: 'The `encoding` option is unsupported without TextDecoder support'
      });
    } else {
      try {
        this.textDecoder_ = new TextDecoder(encoding);
      } catch (error) {
        this.stream.trigger('log', {
          level: 'warn',
          message: 'TextDecoder could not be created with ' + encoding + ' encoding. ' + error
        });
      }
    }
  };

  var Cea708Stream = function Cea708Stream(options) {
    options = options || {};
    Cea708Stream.prototype.init.call(this);
    var self = this;
    var captionServices = options.captionServices || {};
    var captionServiceEncodings = {};
    var serviceProps; // Get service encodings from captionServices option block

    Object.keys(captionServices).forEach(function (serviceName) {
      serviceProps = captionServices[serviceName];

      if (/^SERVICE/.test(serviceName)) {
        captionServiceEncodings[serviceName] = serviceProps.encoding;
      }
    });
    this.serviceEncodings = captionServiceEncodings;
    this.current708Packet = null;
    this.services = {};

    this.push = function (packet) {
      if (packet.type === 3) {
        // 708 packet start
        self.new708Packet();
        self.add708Bytes(packet);
      } else {
        if (self.current708Packet === null) {
          // This should only happen at the start of a file if there's no packet start.
          self.new708Packet();
        }

        self.add708Bytes(packet);
      }
    };
  };

  Cea708Stream.prototype = new stream();
  /**
   * Push current 708 packet, create new 708 packet.
   */

  Cea708Stream.prototype.new708Packet = function () {
    if (this.current708Packet !== null) {
      this.push708Packet();
    }

    this.current708Packet = {
      data: [],
      ptsVals: []
    };
  };
  /**
   * Add pts and both bytes from packet into current 708 packet.
   */


  Cea708Stream.prototype.add708Bytes = function (packet) {
    var data = packet.ccData;
    var byte0 = data >>> 8;
    var byte1 = data & 0xff; // I would just keep a list of packets instead of bytes, but it isn't clear in the spec
    // that service blocks will always line up with byte pairs.

    this.current708Packet.ptsVals.push(packet.pts);
    this.current708Packet.data.push(byte0);
    this.current708Packet.data.push(byte1);
  };
  /**
   * Parse completed 708 packet into service blocks and push each service block.
   */


  Cea708Stream.prototype.push708Packet = function () {
    var packet708 = this.current708Packet;
    var packetData = packet708.data;
    var serviceNum = null;
    var blockSize = null;
    var i = 0;
    var b = packetData[i++];
    packet708.seq = b >> 6;
    packet708.sizeCode = b & 0x3f; // 0b00111111;

    for (; i < packetData.length; i++) {
      b = packetData[i++];
      serviceNum = b >> 5;
      blockSize = b & 0x1f; // 0b00011111

      if (serviceNum === 7 && blockSize > 0) {
        // Extended service num
        b = packetData[i++];
        serviceNum = b;
      }

      this.pushServiceBlock(serviceNum, i, blockSize);

      if (blockSize > 0) {
        i += blockSize - 1;
      }
    }
  };
  /**
   * Parse service block, execute commands, read text.
   *
   * Note: While many of these commands serve important purposes,
   * many others just parse out the parameters or attributes, but
   * nothing is done with them because this is not a full and complete
   * implementation of the entire 708 spec.
   *
   * @param  {Integer} serviceNum Service number
   * @param  {Integer} start      Start index of the 708 packet data
   * @param  {Integer} size       Block size
   */


  Cea708Stream.prototype.pushServiceBlock = function (serviceNum, start, size) {
    var b;
    var i = start;
    var packetData = this.current708Packet.data;
    var service = this.services[serviceNum];

    if (!service) {
      service = this.initService(serviceNum, i);
    }

    for (; i < start + size && i < packetData.length; i++) {
      b = packetData[i];

      if (within708TextBlock(b)) {
        i = this.handleText(i, service);
      } else if (b === 0x18) {
        i = this.multiByteCharacter(i, service);
      } else if (b === 0x10) {
        i = this.extendedCommands(i, service);
      } else if (0x80 <= b && b <= 0x87) {
        i = this.setCurrentWindow(i, service);
      } else if (0x98 <= b && b <= 0x9f) {
        i = this.defineWindow(i, service);
      } else if (b === 0x88) {
        i = this.clearWindows(i, service);
      } else if (b === 0x8c) {
        i = this.deleteWindows(i, service);
      } else if (b === 0x89) {
        i = this.displayWindows(i, service);
      } else if (b === 0x8a) {
        i = this.hideWindows(i, service);
      } else if (b === 0x8b) {
        i = this.toggleWindows(i, service);
      } else if (b === 0x97) {
        i = this.setWindowAttributes(i, service);
      } else if (b === 0x90) {
        i = this.setPenAttributes(i, service);
      } else if (b === 0x91) {
        i = this.setPenColor(i, service);
      } else if (b === 0x92) {
        i = this.setPenLocation(i, service);
      } else if (b === 0x8f) {
        service = this.reset(i, service);
      } else if (b === 0x08) {
        // BS: Backspace
        service.currentWindow.backspace();
      } else if (b === 0x0c) {
        // FF: Form feed
        service.currentWindow.clearText();
      } else if (b === 0x0d) {
        // CR: Carriage return
        service.currentWindow.pendingNewLine = true;
      } else if (b === 0x0e) {
        // HCR: Horizontal carriage return
        service.currentWindow.clearText();
      } else if (b === 0x8d) {
        // DLY: Delay, nothing to do
        i++;
      } else ;
    }
  };
  /**
   * Execute an extended command
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.extendedCommands = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];

    if (within708TextBlock(b)) {
      i = this.handleText(i, service, {
        isExtended: true
      });
    }

    return i;
  };
  /**
   * Get PTS value of a given byte index
   *
   * @param  {Integer} byteIndex  Index of the byte
   * @return {Integer}            PTS
   */


  Cea708Stream.prototype.getPts = function (byteIndex) {
    // There's 1 pts value per 2 bytes
    return this.current708Packet.ptsVals[Math.floor(byteIndex / 2)];
  };
  /**
   * Initializes a service
   *
   * @param  {Integer} serviceNum Service number
   * @return {Service}            Initialized service object
   */


  Cea708Stream.prototype.initService = function (serviceNum, i) {
    var serviceName = 'SERVICE' + serviceNum;
    var self = this;
    var serviceName;
    var encoding;

    if (serviceName in this.serviceEncodings) {
      encoding = this.serviceEncodings[serviceName];
    }

    this.services[serviceNum] = new Cea708Service(serviceNum, encoding, self);
    this.services[serviceNum].init(this.getPts(i), function (pts) {
      self.flushDisplayed(pts, self.services[serviceNum]);
    });
    return this.services[serviceNum];
  };
  /**
   * Execute text writing to current window
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.handleText = function (i, service, options) {
    var isExtended = options && options.isExtended;
    var isMultiByte = options && options.isMultiByte;
    var packetData = this.current708Packet.data;
    var extended = isExtended ? 0x1000 : 0x0000;
    var currentByte = packetData[i];
    var nextByte = packetData[i + 1];
    var win = service.currentWindow;
    var char;
    var charCodeArray; // Use the TextDecoder if one was created for this service

    if (service.textDecoder_ && !isExtended) {
      if (isMultiByte) {
        charCodeArray = [currentByte, nextByte];
        i++;
      } else {
        charCodeArray = [currentByte];
      }

      char = service.textDecoder_.decode(new Uint8Array(charCodeArray));
    } else {
      char = get708CharFromCode(extended | currentByte);
    }

    if (win.pendingNewLine && !win.isEmpty()) {
      win.newLine(this.getPts(i));
    }

    win.pendingNewLine = false;
    win.addText(char);
    return i;
  };
  /**
   * Handle decoding of multibyte character
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.multiByteCharacter = function (i, service) {
    var packetData = this.current708Packet.data;
    var firstByte = packetData[i + 1];
    var secondByte = packetData[i + 2];

    if (within708TextBlock(firstByte) && within708TextBlock(secondByte)) {
      i = this.handleText(++i, service, {
        isMultiByte: true
      });
    }

    return i;
  };
  /**
   * Parse and execute the CW# command.
   *
   * Set the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.setCurrentWindow = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var windowNum = b & 0x07;
    service.setCurrentWindow(windowNum);
    return i;
  };
  /**
   * Parse and execute the DF# command.
   *
   * Define a window and set it as the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.defineWindow = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var windowNum = b & 0x07;
    service.setCurrentWindow(windowNum);
    var win = service.currentWindow;
    b = packetData[++i];
    win.visible = (b & 0x20) >> 5; // v

    win.rowLock = (b & 0x10) >> 4; // rl

    win.columnLock = (b & 0x08) >> 3; // cl

    win.priority = b & 0x07; // p

    b = packetData[++i];
    win.relativePositioning = (b & 0x80) >> 7; // rp

    win.anchorVertical = b & 0x7f; // av

    b = packetData[++i];
    win.anchorHorizontal = b; // ah

    b = packetData[++i];
    win.anchorPoint = (b & 0xf0) >> 4; // ap

    win.rowCount = b & 0x0f; // rc

    b = packetData[++i];
    win.columnCount = b & 0x3f; // cc

    b = packetData[++i];
    win.windowStyle = (b & 0x38) >> 3; // ws

    win.penStyle = b & 0x07; // ps
    // The spec says there are (rowCount+1) "virtual rows"

    win.virtualRowCount = win.rowCount + 1;
    return i;
  };
  /**
   * Parse and execute the SWA command.
   *
   * Set attributes of the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.setWindowAttributes = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var winAttr = service.currentWindow.winAttr;
    b = packetData[++i];
    winAttr.fillOpacity = (b & 0xc0) >> 6; // fo

    winAttr.fillRed = (b & 0x30) >> 4; // fr

    winAttr.fillGreen = (b & 0x0c) >> 2; // fg

    winAttr.fillBlue = b & 0x03; // fb

    b = packetData[++i];
    winAttr.borderType = (b & 0xc0) >> 6; // bt

    winAttr.borderRed = (b & 0x30) >> 4; // br

    winAttr.borderGreen = (b & 0x0c) >> 2; // bg

    winAttr.borderBlue = b & 0x03; // bb

    b = packetData[++i];
    winAttr.borderType += (b & 0x80) >> 5; // bt

    winAttr.wordWrap = (b & 0x40) >> 6; // ww

    winAttr.printDirection = (b & 0x30) >> 4; // pd

    winAttr.scrollDirection = (b & 0x0c) >> 2; // sd

    winAttr.justify = b & 0x03; // j

    b = packetData[++i];
    winAttr.effectSpeed = (b & 0xf0) >> 4; // es

    winAttr.effectDirection = (b & 0x0c) >> 2; // ed

    winAttr.displayEffect = b & 0x03; // de

    return i;
  };
  /**
   * Gather text from all displayed windows and push a caption to output.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   */


  Cea708Stream.prototype.flushDisplayed = function (pts, service) {
    var displayedText = []; // TODO: Positioning not supported, displaying multiple windows will not necessarily
    // display text in the correct order, but sample files so far have not shown any issue.

    for (var winId = 0; winId < 8; winId++) {
      if (service.windows[winId].visible && !service.windows[winId].isEmpty()) {
        displayedText.push(service.windows[winId].getText());
      }
    }

    service.endPts = pts;
    service.text = displayedText.join('\n\n');
    this.pushCaption(service);
    service.startPts = pts;
  };
  /**
   * Push a caption to output if the caption contains text.
   *
   * @param  {Service} service  The service object to be affected
   */


  Cea708Stream.prototype.pushCaption = function (service) {
    if (service.text !== '') {
      this.trigger('data', {
        startPts: service.startPts,
        endPts: service.endPts,
        text: service.text,
        stream: 'cc708_' + service.serviceNum
      });
      service.text = '';
      service.startPts = service.endPts;
    }
  };
  /**
   * Parse and execute the DSW command.
   *
   * Set visible property of windows based on the parsed bitmask.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.displayWindows = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);

    for (var winId = 0; winId < 8; winId++) {
      if (b & 0x01 << winId) {
        service.windows[winId].visible = 1;
      }
    }

    return i;
  };
  /**
   * Parse and execute the HDW command.
   *
   * Set visible property of windows based on the parsed bitmask.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.hideWindows = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);

    for (var winId = 0; winId < 8; winId++) {
      if (b & 0x01 << winId) {
        service.windows[winId].visible = 0;
      }
    }

    return i;
  };
  /**
   * Parse and execute the TGW command.
   *
   * Set visible property of windows based on the parsed bitmask.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.toggleWindows = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);

    for (var winId = 0; winId < 8; winId++) {
      if (b & 0x01 << winId) {
        service.windows[winId].visible ^= 1;
      }
    }

    return i;
  };
  /**
   * Parse and execute the CLW command.
   *
   * Clear text of windows based on the parsed bitmask.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.clearWindows = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);

    for (var winId = 0; winId < 8; winId++) {
      if (b & 0x01 << winId) {
        service.windows[winId].clearText();
      }
    }

    return i;
  };
  /**
   * Parse and execute the DLW command.
   *
   * Re-initialize windows based on the parsed bitmask.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.deleteWindows = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[++i];
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);

    for (var winId = 0; winId < 8; winId++) {
      if (b & 0x01 << winId) {
        service.windows[winId].reset();
      }
    }

    return i;
  };
  /**
   * Parse and execute the SPA command.
   *
   * Set pen attributes of the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.setPenAttributes = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var penAttr = service.currentWindow.penAttr;
    b = packetData[++i];
    penAttr.textTag = (b & 0xf0) >> 4; // tt

    penAttr.offset = (b & 0x0c) >> 2; // o

    penAttr.penSize = b & 0x03; // s

    b = packetData[++i];
    penAttr.italics = (b & 0x80) >> 7; // i

    penAttr.underline = (b & 0x40) >> 6; // u

    penAttr.edgeType = (b & 0x38) >> 3; // et

    penAttr.fontStyle = b & 0x07; // fs

    return i;
  };
  /**
   * Parse and execute the SPC command.
   *
   * Set pen color of the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.setPenColor = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var penColor = service.currentWindow.penColor;
    b = packetData[++i];
    penColor.fgOpacity = (b & 0xc0) >> 6; // fo

    penColor.fgRed = (b & 0x30) >> 4; // fr

    penColor.fgGreen = (b & 0x0c) >> 2; // fg

    penColor.fgBlue = b & 0x03; // fb

    b = packetData[++i];
    penColor.bgOpacity = (b & 0xc0) >> 6; // bo

    penColor.bgRed = (b & 0x30) >> 4; // br

    penColor.bgGreen = (b & 0x0c) >> 2; // bg

    penColor.bgBlue = b & 0x03; // bb

    b = packetData[++i];
    penColor.edgeRed = (b & 0x30) >> 4; // er

    penColor.edgeGreen = (b & 0x0c) >> 2; // eg

    penColor.edgeBlue = b & 0x03; // eb

    return i;
  };
  /**
   * Parse and execute the SPL command.
   *
   * Set pen location of the current window.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Integer}          New index after parsing
   */


  Cea708Stream.prototype.setPenLocation = function (i, service) {
    var packetData = this.current708Packet.data;
    var b = packetData[i];
    var penLoc = service.currentWindow.penLoc; // Positioning isn't really supported at the moment, so this essentially just inserts a linebreak

    service.currentWindow.pendingNewLine = true;
    b = packetData[++i];
    penLoc.row = b & 0x0f; // r

    b = packetData[++i];
    penLoc.column = b & 0x3f; // c

    return i;
  };
  /**
   * Execute the RST command.
   *
   * Reset service to a clean slate. Re-initialize.
   *
   * @param  {Integer} i        Current index in the 708 packet
   * @param  {Service} service  The service object to be affected
   * @return {Service}          Re-initialized service
   */


  Cea708Stream.prototype.reset = function (i, service) {
    var pts = this.getPts(i);
    this.flushDisplayed(pts, service);
    return this.initService(service.serviceNum, i);
  }; // This hash maps non-ASCII, special, and extended character codes to their
  // proper Unicode equivalent. The first keys that are only a single byte
  // are the non-standard ASCII characters, which simply map the CEA608 byte
  // to the standard ASCII/Unicode. The two-byte keys that follow are the CEA608
  // character codes, but have their MSB bitmasked with 0x03 so that a lookup
  // can be performed regardless of the field and data channel on which the
  // character code was received.


  var CHARACTER_TRANSLATION = {
    0x2a: 0xe1,
    // á
    0x5c: 0xe9,
    // é
    0x5e: 0xed,
    // í
    0x5f: 0xf3,
    // ó
    0x60: 0xfa,
    // ú
    0x7b: 0xe7,
    // ç
    0x7c: 0xf7,
    // ÷
    0x7d: 0xd1,
    // Ñ
    0x7e: 0xf1,
    // ñ
    0x7f: 0x2588,
    // █
    0x0130: 0xae,
    // ®
    0x0131: 0xb0,
    // °
    0x0132: 0xbd,
    // ½
    0x0133: 0xbf,
    // ¿
    0x0134: 0x2122,
    // ™
    0x0135: 0xa2,
    // ¢
    0x0136: 0xa3,
    // £
    0x0137: 0x266a,
    // ♪
    0x0138: 0xe0,
    // à
    0x0139: 0xa0,
    //
    0x013a: 0xe8,
    // è
    0x013b: 0xe2,
    // â
    0x013c: 0xea,
    // ê
    0x013d: 0xee,
    // î
    0x013e: 0xf4,
    // ô
    0x013f: 0xfb,
    // û
    0x0220: 0xc1,
    // Á
    0x0221: 0xc9,
    // É
    0x0222: 0xd3,
    // Ó
    0x0223: 0xda,
    // Ú
    0x0224: 0xdc,
    // Ü
    0x0225: 0xfc,
    // ü
    0x0226: 0x2018,
    // ‘
    0x0227: 0xa1,
    // ¡
    0x0228: 0x2a,
    // *
    0x0229: 0x27,
    // '
    0x022a: 0x2014,
    // —
    0x022b: 0xa9,
    // ©
    0x022c: 0x2120,
    // ℠
    0x022d: 0x2022,
    // •
    0x022e: 0x201c,
    // “
    0x022f: 0x201d,
    // ”
    0x0230: 0xc0,
    // À
    0x0231: 0xc2,
    // Â
    0x0232: 0xc7,
    // Ç
    0x0233: 0xc8,
    // È
    0x0234: 0xca,
    // Ê
    0x0235: 0xcb,
    // Ë
    0x0236: 0xeb,
    // ë
    0x0237: 0xce,
    // Î
    0x0238: 0xcf,
    // Ï
    0x0239: 0xef,
    // ï
    0x023a: 0xd4,
    // Ô
    0x023b: 0xd9,
    // Ù
    0x023c: 0xf9,
    // ù
    0x023d: 0xdb,
    // Û
    0x023e: 0xab,
    // «
    0x023f: 0xbb,
    // »
    0x0320: 0xc3,
    // Ã
    0x0321: 0xe3,
    // ã
    0x0322: 0xcd,
    // Í
    0x0323: 0xcc,
    // Ì
    0x0324: 0xec,
    // ì
    0x0325: 0xd2,
    // Ò
    0x0326: 0xf2,
    // ò
    0x0327: 0xd5,
    // Õ
    0x0328: 0xf5,
    // õ
    0x0329: 0x7b,
    // {
    0x032a: 0x7d,
    // }
    0x032b: 0x5c,
    // \
    0x032c: 0x5e,
    // ^
    0x032d: 0x5f,
    // _
    0x032e: 0x7c,
    // |
    0x032f: 0x7e,
    // ~
    0x0330: 0xc4,
    // Ä
    0x0331: 0xe4,
    // ä
    0x0332: 0xd6,
    // Ö
    0x0333: 0xf6,
    // ö
    0x0334: 0xdf,
    // ß
    0x0335: 0xa5,
    // ¥
    0x0336: 0xa4,
    // ¤
    0x0337: 0x2502,
    // │
    0x0338: 0xc5,
    // Å
    0x0339: 0xe5,
    // å
    0x033a: 0xd8,
    // Ø
    0x033b: 0xf8,
    // ø
    0x033c: 0x250c,
    // ┌
    0x033d: 0x2510,
    // ┐
    0x033e: 0x2514,
    // └
    0x033f: 0x2518 // ┘

  };

  var getCharFromCode = function getCharFromCode(code) {
    if (code === null) {
      return '';
    }

    code = CHARACTER_TRANSLATION[code] || code;
    return String.fromCharCode(code);
  }; // the index of the last row in a CEA-608 display buffer


  var BOTTOM_ROW = 14; // This array is used for mapping PACs -> row #, since there's no way of
  // getting it through bit logic.

  var ROWS = [0x1100, 0x1120, 0x1200, 0x1220, 0x1500, 0x1520, 0x1600, 0x1620, 0x1700, 0x1720, 0x1000, 0x1300, 0x1320, 0x1400, 0x1420]; // CEA-608 captions are rendered onto a 34x15 matrix of character
  // cells. The "bottom" row is the last element in the outer array.

  var createDisplayBuffer = function createDisplayBuffer() {
    var result = [],
        i = BOTTOM_ROW + 1;

    while (i--) {
      result.push('');
    }

    return result;
  };

  var Cea608Stream = function Cea608Stream(field, dataChannel) {
    Cea608Stream.prototype.init.call(this);
    this.field_ = field || 0;
    this.dataChannel_ = dataChannel || 0;
    this.name_ = 'CC' + ((this.field_ << 1 | this.dataChannel_) + 1);
    this.setConstants();
    this.reset();

    this.push = function (packet) {
      var data, swap, char0, char1, text; // remove the parity bits

      data = packet.ccData & 0x7f7f; // ignore duplicate control codes; the spec demands they're sent twice

      if (data === this.lastControlCode_) {
        this.lastControlCode_ = null;
        return;
      } // Store control codes


      if ((data & 0xf000) === 0x1000) {
        this.lastControlCode_ = data;
      } else if (data !== this.PADDING_) {
        this.lastControlCode_ = null;
      }

      char0 = data >>> 8;
      char1 = data & 0xff;

      if (data === this.PADDING_) {
        return;
      } else if (data === this.RESUME_CAPTION_LOADING_) {
        this.mode_ = 'popOn';
      } else if (data === this.END_OF_CAPTION_) {
        // If an EOC is received while in paint-on mode, the displayed caption
        // text should be swapped to non-displayed memory as if it was a pop-on
        // caption. Because of that, we should explicitly switch back to pop-on
        // mode
        this.mode_ = 'popOn';
        this.clearFormatting(packet.pts); // if a caption was being displayed, it's gone now

        this.flushDisplayed(packet.pts); // flip memory

        swap = this.displayed_;
        this.displayed_ = this.nonDisplayed_;
        this.nonDisplayed_ = swap; // start measuring the time to display the caption

        this.startPts_ = packet.pts;
      } else if (data === this.ROLL_UP_2_ROWS_) {
        this.rollUpRows_ = 2;
        this.setRollUp(packet.pts);
      } else if (data === this.ROLL_UP_3_ROWS_) {
        this.rollUpRows_ = 3;
        this.setRollUp(packet.pts);
      } else if (data === this.ROLL_UP_4_ROWS_) {
        this.rollUpRows_ = 4;
        this.setRollUp(packet.pts);
      } else if (data === this.CARRIAGE_RETURN_) {
        this.clearFormatting(packet.pts);
        this.flushDisplayed(packet.pts);
        this.shiftRowsUp_();
        this.startPts_ = packet.pts;
      } else if (data === this.BACKSPACE_) {
        if (this.mode_ === 'popOn') {
          this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
        } else {
          this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
        }
      } else if (data === this.ERASE_DISPLAYED_MEMORY_) {
        this.flushDisplayed(packet.pts);
        this.displayed_ = createDisplayBuffer();
      } else if (data === this.ERASE_NON_DISPLAYED_MEMORY_) {
        this.nonDisplayed_ = createDisplayBuffer();
      } else if (data === this.RESUME_DIRECT_CAPTIONING_) {
        if (this.mode_ !== 'paintOn') {
          // NOTE: This should be removed when proper caption positioning is
          // implemented
          this.flushDisplayed(packet.pts);
          this.displayed_ = createDisplayBuffer();
        }

        this.mode_ = 'paintOn';
        this.startPts_ = packet.pts; // Append special characters to caption text
      } else if (this.isSpecialCharacter(char0, char1)) {
        // Bitmask char0 so that we can apply character transformations
        // regardless of field and data channel.
        // Then byte-shift to the left and OR with char1 so we can pass the
        // entire character code to `getCharFromCode`.
        char0 = (char0 & 0x03) << 8;
        text = getCharFromCode(char0 | char1);
        this[this.mode_](packet.pts, text);
        this.column_++; // Append extended characters to caption text
      } else if (this.isExtCharacter(char0, char1)) {
        // Extended characters always follow their "non-extended" equivalents.
        // IE if a "è" is desired, you'll always receive "eè"; non-compliant
        // decoders are supposed to drop the "è", while compliant decoders
        // backspace the "e" and insert "è".
        // Delete the previous character
        if (this.mode_ === 'popOn') {
          this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
        } else {
          this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
        } // Bitmask char0 so that we can apply character transformations
        // regardless of field and data channel.
        // Then byte-shift to the left and OR with char1 so we can pass the
        // entire character code to `getCharFromCode`.


        char0 = (char0 & 0x03) << 8;
        text = getCharFromCode(char0 | char1);
        this[this.mode_](packet.pts, text);
        this.column_++; // Process mid-row codes
      } else if (this.isMidRowCode(char0, char1)) {
        // Attributes are not additive, so clear all formatting
        this.clearFormatting(packet.pts); // According to the standard, mid-row codes
        // should be replaced with spaces, so add one now

        this[this.mode_](packet.pts, ' ');
        this.column_++;

        if ((char1 & 0xe) === 0xe) {
          this.addFormatting(packet.pts, ['i']);
        }

        if ((char1 & 0x1) === 0x1) {
          this.addFormatting(packet.pts, ['u']);
        } // Detect offset control codes and adjust cursor

      } else if (this.isOffsetControlCode(char0, char1)) {
        // Cursor position is set by indent PAC (see below) in 4-column
        // increments, with an additional offset code of 1-3 to reach any
        // of the 32 columns specified by CEA-608. So all we need to do
        // here is increment the column cursor by the given offset.
        this.column_ += char1 & 0x03; // Detect PACs (Preamble Address Codes)
      } else if (this.isPAC(char0, char1)) {
        // There's no logic for PAC -> row mapping, so we have to just
        // find the row code in an array and use its index :(
        var row = ROWS.indexOf(data & 0x1f20); // Configure the caption window if we're in roll-up mode

        if (this.mode_ === 'rollUp') {
          // This implies that the base row is incorrectly set.
          // As per the recommendation in CEA-608(Base Row Implementation), defer to the number
          // of roll-up rows set.
          if (row - this.rollUpRows_ + 1 < 0) {
            row = this.rollUpRows_ - 1;
          }

          this.setRollUp(packet.pts, row);
        }

        if (row !== this.row_) {
          // formatting is only persistent for current row
          this.clearFormatting(packet.pts);
          this.row_ = row;
        } // All PACs can apply underline, so detect and apply
        // (All odd-numbered second bytes set underline)


        if (char1 & 0x1 && this.formatting_.indexOf('u') === -1) {
          this.addFormatting(packet.pts, ['u']);
        }

        if ((data & 0x10) === 0x10) {
          // We've got an indent level code. Each successive even number
          // increments the column cursor by 4, so we can get the desired
          // column position by bit-shifting to the right (to get n/2)
          // and multiplying by 4.
          this.column_ = ((data & 0xe) >> 1) * 4;
        }

        if (this.isColorPAC(char1)) {
          // it's a color code, though we only support white, which
          // can be either normal or italicized. white italics can be
          // either 0x4e or 0x6e depending on the row, so we just
          // bitwise-and with 0xe to see if italics should be turned on
          if ((char1 & 0xe) === 0xe) {
            this.addFormatting(packet.pts, ['i']);
          }
        } // We have a normal character in char0, and possibly one in char1

      } else if (this.isNormalChar(char0)) {
        if (char1 === 0x00) {
          char1 = null;
        }

        text = getCharFromCode(char0);
        text += getCharFromCode(char1);
        this[this.mode_](packet.pts, text);
        this.column_ += text.length;
      } // finish data processing

    };
  };

  Cea608Stream.prototype = new stream(); // Trigger a cue point that captures the current state of the
  // display buffer

  Cea608Stream.prototype.flushDisplayed = function (pts) {
    var content = this.displayed_ // remove spaces from the start and end of the string
    .map(function (row, index) {
      try {
        return row.trim();
      } catch (e) {
        // Ordinarily, this shouldn't happen. However, caption
        // parsing errors should not throw exceptions and
        // break playback.
        this.trigger('log', {
          level: 'warn',
          message: 'Skipping a malformed 608 caption at index ' + index + '.'
        });
        return '';
      }
    }, this) // combine all text rows to display in one cue
    .join('\n') // and remove blank rows from the start and end, but not the middle
    .replace(/^\n+|\n+$/g, '');

    if (content.length) {
      this.trigger('data', {
        startPts: this.startPts_,
        endPts: pts,
        text: content,
        stream: this.name_
      });
    }
  };
  /**
   * Zero out the data, used for startup and on seek
   */


  Cea608Stream.prototype.reset = function () {
    this.mode_ = 'popOn'; // When in roll-up mode, the index of the last row that will
    // actually display captions. If a caption is shifted to a row
    // with a lower index than this, it is cleared from the display
    // buffer

    this.topRow_ = 0;
    this.startPts_ = 0;
    this.displayed_ = createDisplayBuffer();
    this.nonDisplayed_ = createDisplayBuffer();
    this.lastControlCode_ = null; // Track row and column for proper line-breaking and spacing

    this.column_ = 0;
    this.row_ = BOTTOM_ROW;
    this.rollUpRows_ = 2; // This variable holds currently-applied formatting

    this.formatting_ = [];
  };
  /**
   * Sets up control code and related constants for this instance
   */


  Cea608Stream.prototype.setConstants = function () {
    // The following attributes have these uses:
    // ext_ :    char0 for mid-row codes, and the base for extended
    //           chars (ext_+0, ext_+1, and ext_+2 are char0s for
    //           extended codes)
    // control_: char0 for control codes, except byte-shifted to the
    //           left so that we can do this.control_ | CONTROL_CODE
    // offset_:  char0 for tab offset codes
    //
    // It's also worth noting that control codes, and _only_ control codes,
    // differ between field 1 and field2. Field 2 control codes are always
    // their field 1 value plus 1. That's why there's the "| field" on the
    // control value.
    if (this.dataChannel_ === 0) {
      this.BASE_ = 0x10;
      this.EXT_ = 0x11;
      this.CONTROL_ = (0x14 | this.field_) << 8;
      this.OFFSET_ = 0x17;
    } else if (this.dataChannel_ === 1) {
      this.BASE_ = 0x18;
      this.EXT_ = 0x19;
      this.CONTROL_ = (0x1c | this.field_) << 8;
      this.OFFSET_ = 0x1f;
    } // Constants for the LSByte command codes recognized by Cea608Stream. This
    // list is not exhaustive. For a more comprehensive listing and semantics see
    // http://www.gpo.gov/fdsys/pkg/CFR-2010-title47-vol1/pdf/CFR-2010-title47-vol1-sec15-119.pdf
    // Padding


    this.PADDING_ = 0x0000; // Pop-on Mode

    this.RESUME_CAPTION_LOADING_ = this.CONTROL_ | 0x20;
    this.END_OF_CAPTION_ = this.CONTROL_ | 0x2f; // Roll-up Mode

    this.ROLL_UP_2_ROWS_ = this.CONTROL_ | 0x25;
    this.ROLL_UP_3_ROWS_ = this.CONTROL_ | 0x26;
    this.ROLL_UP_4_ROWS_ = this.CONTROL_ | 0x27;
    this.CARRIAGE_RETURN_ = this.CONTROL_ | 0x2d; // paint-on mode

    this.RESUME_DIRECT_CAPTIONING_ = this.CONTROL_ | 0x29; // Erasure

    this.BACKSPACE_ = this.CONTROL_ | 0x21;
    this.ERASE_DISPLAYED_MEMORY_ = this.CONTROL_ | 0x2c;
    this.ERASE_NON_DISPLAYED_MEMORY_ = this.CONTROL_ | 0x2e;
  };
  /**
   * Detects if the 2-byte packet data is a special character
   *
   * Special characters have a second byte in the range 0x30 to 0x3f,
   * with the first byte being 0x11 (for data channel 1) or 0x19 (for
   * data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an special character
   */


  Cea608Stream.prototype.isSpecialCharacter = function (char0, char1) {
    return char0 === this.EXT_ && char1 >= 0x30 && char1 <= 0x3f;
  };
  /**
   * Detects if the 2-byte packet data is an extended character
   *
   * Extended characters have a second byte in the range 0x20 to 0x3f,
   * with the first byte being 0x12 or 0x13 (for data channel 1) or
   * 0x1a or 0x1b (for data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an extended character
   */


  Cea608Stream.prototype.isExtCharacter = function (char0, char1) {
    return (char0 === this.EXT_ + 1 || char0 === this.EXT_ + 2) && char1 >= 0x20 && char1 <= 0x3f;
  };
  /**
   * Detects if the 2-byte packet is a mid-row code
   *
   * Mid-row codes have a second byte in the range 0x20 to 0x2f, with
   * the first byte being 0x11 (for data channel 1) or 0x19 (for data
   * channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are a mid-row code
   */


  Cea608Stream.prototype.isMidRowCode = function (char0, char1) {
    return char0 === this.EXT_ && char1 >= 0x20 && char1 <= 0x2f;
  };
  /**
   * Detects if the 2-byte packet is an offset control code
   *
   * Offset control codes have a second byte in the range 0x21 to 0x23,
   * with the first byte being 0x17 (for data channel 1) or 0x1f (for
   * data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an offset control code
   */


  Cea608Stream.prototype.isOffsetControlCode = function (char0, char1) {
    return char0 === this.OFFSET_ && char1 >= 0x21 && char1 <= 0x23;
  };
  /**
   * Detects if the 2-byte packet is a Preamble Address Code
   *
   * PACs have a first byte in the range 0x10 to 0x17 (for data channel 1)
   * or 0x18 to 0x1f (for data channel 2), with the second byte in the
   * range 0x40 to 0x7f.
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are a PAC
   */


  Cea608Stream.prototype.isPAC = function (char0, char1) {
    return char0 >= this.BASE_ && char0 < this.BASE_ + 8 && char1 >= 0x40 && char1 <= 0x7f;
  };
  /**
   * Detects if a packet's second byte is in the range of a PAC color code
   *
   * PAC color codes have the second byte be in the range 0x40 to 0x4f, or
   * 0x60 to 0x6f.
   *
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the byte is a color PAC
   */


  Cea608Stream.prototype.isColorPAC = function (char1) {
    return char1 >= 0x40 && char1 <= 0x4f || char1 >= 0x60 && char1 <= 0x7f;
  };
  /**
   * Detects if a single byte is in the range of a normal character
   *
   * Normal text bytes are in the range 0x20 to 0x7f.
   *
   * @param  {Integer} char  The byte
   * @return {Boolean}       Whether the byte is a normal character
   */


  Cea608Stream.prototype.isNormalChar = function (char) {
    return char >= 0x20 && char <= 0x7f;
  };
  /**
   * Configures roll-up
   *
   * @param  {Integer} pts         Current PTS
   * @param  {Integer} newBaseRow  Used by PACs to slide the current window to
   *                               a new position
   */


  Cea608Stream.prototype.setRollUp = function (pts, newBaseRow) {
    // Reset the base row to the bottom row when switching modes
    if (this.mode_ !== 'rollUp') {
      this.row_ = BOTTOM_ROW;
      this.mode_ = 'rollUp'; // Spec says to wipe memories when switching to roll-up

      this.flushDisplayed(pts);
      this.nonDisplayed_ = createDisplayBuffer();
      this.displayed_ = createDisplayBuffer();
    }

    if (newBaseRow !== undefined && newBaseRow !== this.row_) {
      // move currently displayed captions (up or down) to the new base row
      for (var i = 0; i < this.rollUpRows_; i++) {
        this.displayed_[newBaseRow - i] = this.displayed_[this.row_ - i];
        this.displayed_[this.row_ - i] = '';
      }
    }

    if (newBaseRow === undefined) {
      newBaseRow = this.row_;
    }

    this.topRow_ = newBaseRow - this.rollUpRows_ + 1;
  }; // Adds the opening HTML tag for the passed character to the caption text,
  // and keeps track of it for later closing


  Cea608Stream.prototype.addFormatting = function (pts, format) {
    this.formatting_ = this.formatting_.concat(format);
    var text = format.reduce(function (text, format) {
      return text + '<' + format + '>';
    }, '');
    this[this.mode_](pts, text);
  }; // Adds HTML closing tags for current formatting to caption text and
  // clears remembered formatting


  Cea608Stream.prototype.clearFormatting = function (pts) {
    if (!this.formatting_.length) {
      return;
    }

    var text = this.formatting_.reverse().reduce(function (text, format) {
      return text + '</' + format + '>';
    }, '');
    this.formatting_ = [];
    this[this.mode_](pts, text);
  }; // Mode Implementations


  Cea608Stream.prototype.popOn = function (pts, text) {
    var baseRow = this.nonDisplayed_[this.row_]; // buffer characters

    baseRow += text;
    this.nonDisplayed_[this.row_] = baseRow;
  };

  Cea608Stream.prototype.rollUp = function (pts, text) {
    var baseRow = this.displayed_[this.row_];
    baseRow += text;
    this.displayed_[this.row_] = baseRow;
  };

  Cea608Stream.prototype.shiftRowsUp_ = function () {
    var i; // clear out inactive rows

    for (i = 0; i < this.topRow_; i++) {
      this.displayed_[i] = '';
    }

    for (i = this.row_ + 1; i < BOTTOM_ROW + 1; i++) {
      this.displayed_[i] = '';
    } // shift displayed rows up


    for (i = this.topRow_; i < this.row_; i++) {
      this.displayed_[i] = this.displayed_[i + 1];
    } // clear out the bottom row


    this.displayed_[this.row_] = '';
  };

  Cea608Stream.prototype.paintOn = function (pts, text) {
    var baseRow = this.displayed_[this.row_];
    baseRow += text;
    this.displayed_[this.row_] = baseRow;
  }; // exports


  var captionStream = {
    CaptionStream: CaptionStream$1,
    Cea608Stream: Cea608Stream,
    Cea708Stream: Cea708Stream
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var streamTypes = {
    H264_STREAM_TYPE: 0x1B,
    ADTS_STREAM_TYPE: 0x0F,
    METADATA_STREAM_TYPE: 0x15
  };
  var MAX_TS = 8589934592;
  var RO_THRESH = 4294967296;
  var TYPE_SHARED = 'shared';

  var handleRollover$1 = function handleRollover(value, reference) {
    var direction = 1;

    if (value > reference) {
      // If the current timestamp value is greater than our reference timestamp and we detect a
      // timestamp rollover, this means the roll over is happening in the opposite direction.
      // Example scenario: Enter a long stream/video just after a rollover occurred. The reference
      // point will be set to a small number, e.g. 1. The user then seeks backwards over the
      // rollover point. In loading this segment, the timestamp values will be very large,
      // e.g. 2^33 - 1. Since this comes before the data we loaded previously, we want to adjust
      // the time stamp to be `value - 2^33`.
      direction = -1;
    } // Note: A seek forwards or back that is greater than the RO_THRESH (2^32, ~13 hours) will
    // cause an incorrect adjustment.


    while (Math.abs(reference - value) > RO_THRESH) {
      value += direction * MAX_TS;
    }

    return value;
  };

  var TimestampRolloverStream$1 = function TimestampRolloverStream(type) {
    var lastDTS, referenceDTS;
    TimestampRolloverStream.prototype.init.call(this); // The "shared" type is used in cases where a stream will contain muxed
    // video and audio. We could use `undefined` here, but having a string
    // makes debugging a little clearer.

    this.type_ = type || TYPE_SHARED;

    this.push = function (data) {
      // Any "shared" rollover streams will accept _all_ data. Otherwise,
      // streams will only accept data that matches their type.
      if (this.type_ !== TYPE_SHARED && data.type !== this.type_) {
        return;
      }

      if (referenceDTS === undefined) {
        referenceDTS = data.dts;
      }

      data.dts = handleRollover$1(data.dts, referenceDTS);
      data.pts = handleRollover$1(data.pts, referenceDTS);
      lastDTS = data.dts;
      this.trigger('data', data);
    };

    this.flush = function () {
      referenceDTS = lastDTS;
      this.trigger('done');
    };

    this.endTimeline = function () {
      this.flush();
      this.trigger('endedtimeline');
    };

    this.discontinuity = function () {
      referenceDTS = void 0;
      lastDTS = void 0;
    };

    this.reset = function () {
      this.discontinuity();
      this.trigger('reset');
    };
  };

  TimestampRolloverStream$1.prototype = new stream();
  var timestampRolloverStream = {
    TimestampRolloverStream: TimestampRolloverStream$1,
    handleRollover: handleRollover$1
  };

  var percentEncode$1 = function percentEncode(bytes, start, end) {
    var i,
        result = '';

    for (i = start; i < end; i++) {
      result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
    }

    return result;
  },
      // return the string representation of the specified byte range,
  // interpreted as UTf-8.
  parseUtf8 = function parseUtf8(bytes, start, end) {
    return decodeURIComponent(percentEncode$1(bytes, start, end));
  },
      // return the string representation of the specified byte range,
  // interpreted as ISO-8859-1.
  parseIso88591$1 = function parseIso88591(bytes, start, end) {
    return unescape(percentEncode$1(bytes, start, end)); // jshint ignore:line
  },
      parseSyncSafeInteger$1 = function parseSyncSafeInteger(data) {
    return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
  },
      tagParsers = {
    TXXX: function TXXX(tag) {
      var i;

      if (tag.data[0] !== 3) {
        // ignore frames with unrecognized character encodings
        return;
      }

      for (i = 1; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the text fields
          tag.description = parseUtf8(tag.data, 1, i); // do not include the null terminator in the tag value

          tag.value = parseUtf8(tag.data, i + 1, tag.data.length).replace(/\0*$/, '');
          break;
        }
      }

      tag.data = tag.value;
    },
    WXXX: function WXXX(tag) {
      var i;

      if (tag.data[0] !== 3) {
        // ignore frames with unrecognized character encodings
        return;
      }

      for (i = 1; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the description and URL fields
          tag.description = parseUtf8(tag.data, 1, i);
          tag.url = parseUtf8(tag.data, i + 1, tag.data.length);
          break;
        }
      }
    },
    PRIV: function PRIV(tag) {
      var i;

      for (i = 0; i < tag.data.length; i++) {
        if (tag.data[i] === 0) {
          // parse the description and URL fields
          tag.owner = parseIso88591$1(tag.data, 0, i);
          break;
        }
      }

      tag.privateData = tag.data.subarray(i + 1);
      tag.data = tag.privateData;
    }
  },
      _MetadataStream;

  _MetadataStream = function MetadataStream(options) {
    var settings = {
      // the bytes of the program-level descriptor field in MP2T
      // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
      // program element descriptors"
      descriptor: options && options.descriptor
    },
        // the total size in bytes of the ID3 tag being parsed
    tagSize = 0,
        // tag data that is not complete enough to be parsed
    buffer = [],
        // the total number of bytes currently in the buffer
    bufferSize = 0,
        i;

    _MetadataStream.prototype.init.call(this); // calculate the text track in-band metadata track dispatch type
    // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track


    this.dispatchType = streamTypes.METADATA_STREAM_TYPE.toString(16);

    if (settings.descriptor) {
      for (i = 0; i < settings.descriptor.length; i++) {
        this.dispatchType += ('00' + settings.descriptor[i].toString(16)).slice(-2);
      }
    }

    this.push = function (chunk) {
      var tag, frameStart, frameSize, frame, i, frameHeader;

      if (chunk.type !== 'timed-metadata') {
        return;
      } // if data_alignment_indicator is set in the PES header,
      // we must have the start of a new ID3 tag. Assume anything
      // remaining in the buffer was malformed and throw it out


      if (chunk.dataAlignmentIndicator) {
        bufferSize = 0;
        buffer.length = 0;
      } // ignore events that don't look like ID3 data


      if (buffer.length === 0 && (chunk.data.length < 10 || chunk.data[0] !== 'I'.charCodeAt(0) || chunk.data[1] !== 'D'.charCodeAt(0) || chunk.data[2] !== '3'.charCodeAt(0))) {
        this.trigger('log', {
          level: 'warn',
          message: 'Skipping unrecognized metadata packet'
        });
        return;
      } // add this chunk to the data we've collected so far


      buffer.push(chunk);
      bufferSize += chunk.data.byteLength; // grab the size of the entire frame from the ID3 header

      if (buffer.length === 1) {
        // the frame size is transmitted as a 28-bit integer in the
        // last four bytes of the ID3 header.
        // The most significant bit of each byte is dropped and the
        // results concatenated to recover the actual value.
        tagSize = parseSyncSafeInteger$1(chunk.data.subarray(6, 10)); // ID3 reports the tag size excluding the header but it's more
        // convenient for our comparisons to include it

        tagSize += 10;
      } // if the entire frame has not arrived, wait for more data


      if (bufferSize < tagSize) {
        return;
      } // collect the entire frame so it can be parsed


      tag = {
        data: new Uint8Array(tagSize),
        frames: [],
        pts: buffer[0].pts,
        dts: buffer[0].dts
      };

      for (i = 0; i < tagSize;) {
        tag.data.set(buffer[0].data.subarray(0, tagSize - i), i);
        i += buffer[0].data.byteLength;
        bufferSize -= buffer[0].data.byteLength;
        buffer.shift();
      } // find the start of the first frame and the end of the tag


      frameStart = 10;

      if (tag.data[5] & 0x40) {
        // advance the frame start past the extended header
        frameStart += 4; // header size field

        frameStart += parseSyncSafeInteger$1(tag.data.subarray(10, 14)); // clip any padding off the end

        tagSize -= parseSyncSafeInteger$1(tag.data.subarray(16, 20));
      } // parse one or more ID3 frames
      // http://id3.org/id3v2.3.0#ID3v2_frame_overview


      do {
        // determine the number of bytes in this frame
        frameSize = parseSyncSafeInteger$1(tag.data.subarray(frameStart + 4, frameStart + 8));

        if (frameSize < 1) {
          this.trigger('log', {
            level: 'warn',
            message: 'Malformed ID3 frame encountered. Skipping metadata parsing.'
          });
          return;
        }

        frameHeader = String.fromCharCode(tag.data[frameStart], tag.data[frameStart + 1], tag.data[frameStart + 2], tag.data[frameStart + 3]);
        frame = {
          id: frameHeader,
          data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
        };
        frame.key = frame.id;

        if (tagParsers[frame.id]) {
          tagParsers[frame.id](frame); // handle the special PRIV frame used to indicate the start
          // time for raw AAC data

          if (frame.owner === 'com.apple.streaming.transportStreamTimestamp') {
            var d = frame.data,
                size = (d[3] & 0x01) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
            size *= 4;
            size += d[7] & 0x03;
            frame.timeStamp = size; // in raw AAC, all subsequent data will be timestamped based
            // on the value of this frame
            // we couldn't have known the appropriate pts and dts before
            // parsing this ID3 tag so set those values now

            if (tag.pts === undefined && tag.dts === undefined) {
              tag.pts = frame.timeStamp;
              tag.dts = frame.timeStamp;
            }

            this.trigger('timestamp', frame);
          }
        }

        tag.frames.push(frame);
        frameStart += 10; // advance past the frame header

        frameStart += frameSize; // advance past the frame body
      } while (frameStart < tagSize);

      this.trigger('data', tag);
    };
  };

  _MetadataStream.prototype = new stream();
  var metadataStream = _MetadataStream;
  var TimestampRolloverStream = timestampRolloverStream.TimestampRolloverStream; // object types

  var _TransportPacketStream, _TransportParseStream, _ElementaryStream; // constants


  var MP2T_PACKET_LENGTH$1 = 188,
      // bytes
  SYNC_BYTE$1 = 0x47;
  /**
   * Splits an incoming stream of binary data into MPEG-2 Transport
   * Stream packets.
   */

  _TransportPacketStream = function TransportPacketStream() {
    var buffer = new Uint8Array(MP2T_PACKET_LENGTH$1),
        bytesInBuffer = 0;

    _TransportPacketStream.prototype.init.call(this); // Deliver new bytes to the stream.

    /**
     * Split a stream of data into M2TS packets
    **/


    this.push = function (bytes) {
      var startIndex = 0,
          endIndex = MP2T_PACKET_LENGTH$1,
          everything; // If there are bytes remaining from the last segment, prepend them to the
      // bytes that were pushed in

      if (bytesInBuffer) {
        everything = new Uint8Array(bytes.byteLength + bytesInBuffer);
        everything.set(buffer.subarray(0, bytesInBuffer));
        everything.set(bytes, bytesInBuffer);
        bytesInBuffer = 0;
      } else {
        everything = bytes;
      } // While we have enough data for a packet


      while (endIndex < everything.byteLength) {
        // Look for a pair of start and end sync bytes in the data..
        if (everything[startIndex] === SYNC_BYTE$1 && everything[endIndex] === SYNC_BYTE$1) {
          // We found a packet so emit it and jump one whole packet forward in
          // the stream
          this.trigger('data', everything.subarray(startIndex, endIndex));
          startIndex += MP2T_PACKET_LENGTH$1;
          endIndex += MP2T_PACKET_LENGTH$1;
          continue;
        } // If we get here, we have somehow become de-synchronized and we need to step
        // forward one byte at a time until we find a pair of sync bytes that denote
        // a packet


        startIndex++;
        endIndex++;
      } // If there was some data left over at the end of the segment that couldn't
      // possibly be a whole packet, keep it because it might be the start of a packet
      // that continues in the next segment


      if (startIndex < everything.byteLength) {
        buffer.set(everything.subarray(startIndex), 0);
        bytesInBuffer = everything.byteLength - startIndex;
      }
    };
    /**
     * Passes identified M2TS packets to the TransportParseStream to be parsed
    **/


    this.flush = function () {
      // If the buffer contains a whole packet when we are being flushed, emit it
      // and empty the buffer. Otherwise hold onto the data because it may be
      // important for decoding the next segment
      if (bytesInBuffer === MP2T_PACKET_LENGTH$1 && buffer[0] === SYNC_BYTE$1) {
        this.trigger('data', buffer);
        bytesInBuffer = 0;
      }

      this.trigger('done');
    };

    this.endTimeline = function () {
      this.flush();
      this.trigger('endedtimeline');
    };

    this.reset = function () {
      bytesInBuffer = 0;
      this.trigger('reset');
    };
  };

  _TransportPacketStream.prototype = new stream();
  /**
   * Accepts an MP2T TransportPacketStream and emits data events with parsed
   * forms of the individual transport stream packets.
   */

  _TransportParseStream = function TransportParseStream() {
    var parsePsi, parsePat, parsePmt, self;

    _TransportParseStream.prototype.init.call(this);

    self = this;
    this.packetsWaitingForPmt = [];
    this.programMapTable = undefined;

    parsePsi = function parsePsi(payload, psi) {
      var offset = 0; // PSI packets may be split into multiple sections and those
      // sections may be split into multiple packets. If a PSI
      // section starts in this packet, the payload_unit_start_indicator
      // will be true and the first byte of the payload will indicate
      // the offset from the current position to the start of the
      // section.

      if (psi.payloadUnitStartIndicator) {
        offset += payload[offset] + 1;
      }

      if (psi.type === 'pat') {
        parsePat(payload.subarray(offset), psi);
      } else {
        parsePmt(payload.subarray(offset), psi);
      }
    };

    parsePat = function parsePat(payload, pat) {
      pat.section_number = payload[7]; // eslint-disable-line camelcase

      pat.last_section_number = payload[8]; // eslint-disable-line camelcase
      // skip the PSI header and parse the first PMT entry

      self.pmtPid = (payload[10] & 0x1F) << 8 | payload[11];
      pat.pmtPid = self.pmtPid;
    };
    /**
     * Parse out the relevant fields of a Program Map Table (PMT).
     * @param payload {Uint8Array} the PMT-specific portion of an MP2T
     * packet. The first byte in this array should be the table_id
     * field.
     * @param pmt {object} the object that should be decorated with
     * fields parsed from the PMT.
     */


    parsePmt = function parsePmt(payload, pmt) {
      var sectionLength, tableEnd, programInfoLength, offset; // PMTs can be sent ahead of the time when they should actually
      // take effect. We don't believe this should ever be the case
      // for HLS but we'll ignore "forward" PMT declarations if we see
      // them. Future PMT declarations have the current_next_indicator
      // set to zero.

      if (!(payload[5] & 0x01)) {
        return;
      } // overwrite any existing program map table


      self.programMapTable = {
        video: null,
        audio: null,
        'timed-metadata': {}
      }; // the mapping table ends at the end of the current section

      sectionLength = (payload[1] & 0x0f) << 8 | payload[2];
      tableEnd = 3 + sectionLength - 4; // to determine where the table is, we have to figure out how
      // long the program info descriptors are

      programInfoLength = (payload[10] & 0x0f) << 8 | payload[11]; // advance the offset to the first entry in the mapping table

      offset = 12 + programInfoLength;

      while (offset < tableEnd) {
        var streamType = payload[offset];
        var pid = (payload[offset + 1] & 0x1F) << 8 | payload[offset + 2]; // only map a single elementary_pid for audio and video stream types
        // TODO: should this be done for metadata too? for now maintain behavior of
        //       multiple metadata streams

        if (streamType === streamTypes.H264_STREAM_TYPE && self.programMapTable.video === null) {
          self.programMapTable.video = pid;
        } else if (streamType === streamTypes.ADTS_STREAM_TYPE && self.programMapTable.audio === null) {
          self.programMapTable.audio = pid;
        } else if (streamType === streamTypes.METADATA_STREAM_TYPE) {
          // map pid to stream type for metadata streams
          self.programMapTable['timed-metadata'][pid] = streamType;
        } // move to the next table entry
        // skip past the elementary stream descriptors, if present


        offset += ((payload[offset + 3] & 0x0F) << 8 | payload[offset + 4]) + 5;
      } // record the map on the packet as well


      pmt.programMapTable = self.programMapTable;
    };
    /**
     * Deliver a new MP2T packet to the next stream in the pipeline.
     */


    this.push = function (packet) {
      var result = {},
          offset = 4;
      result.payloadUnitStartIndicator = !!(packet[1] & 0x40); // pid is a 13-bit field starting at the last bit of packet[1]

      result.pid = packet[1] & 0x1f;
      result.pid <<= 8;
      result.pid |= packet[2]; // if an adaption field is present, its length is specified by the
      // fifth byte of the TS packet header. The adaptation field is
      // used to add stuffing to PES packets that don't fill a complete
      // TS packet, and to specify some forms of timing and control data
      // that we do not currently use.

      if ((packet[3] & 0x30) >>> 4 > 0x01) {
        offset += packet[offset] + 1;
      } // parse the rest of the packet based on the type


      if (result.pid === 0) {
        result.type = 'pat';
        parsePsi(packet.subarray(offset), result);
        this.trigger('data', result);
      } else if (result.pid === this.pmtPid) {
        result.type = 'pmt';
        parsePsi(packet.subarray(offset), result);
        this.trigger('data', result); // if there are any packets waiting for a PMT to be found, process them now

        while (this.packetsWaitingForPmt.length) {
          this.processPes_.apply(this, this.packetsWaitingForPmt.shift());
        }
      } else if (this.programMapTable === undefined) {
        // When we have not seen a PMT yet, defer further processing of
        // PES packets until one has been parsed
        this.packetsWaitingForPmt.push([packet, offset, result]);
      } else {
        this.processPes_(packet, offset, result);
      }
    };

    this.processPes_ = function (packet, offset, result) {
      // set the appropriate stream type
      if (result.pid === this.programMapTable.video) {
        result.streamType = streamTypes.H264_STREAM_TYPE;
      } else if (result.pid === this.programMapTable.audio) {
        result.streamType = streamTypes.ADTS_STREAM_TYPE;
      } else {
        // if not video or audio, it is timed-metadata or unknown
        // if unknown, streamType will be undefined
        result.streamType = this.programMapTable['timed-metadata'][result.pid];
      }

      result.type = 'pes';
      result.data = packet.subarray(offset);
      this.trigger('data', result);
    };
  };

  _TransportParseStream.prototype = new stream();
  _TransportParseStream.STREAM_TYPES = {
    h264: 0x1b,
    adts: 0x0f
  };
  /**
   * Reconsistutes program elementary stream (PES) packets from parsed
   * transport stream packets. That is, if you pipe an
   * mp2t.TransportParseStream into a mp2t.ElementaryStream, the output
   * events will be events which capture the bytes for individual PES
   * packets plus relevant metadata that has been extracted from the
   * container.
   */

  _ElementaryStream = function ElementaryStream() {
    var self = this,
        segmentHadPmt = false,
        // PES packet fragments
    video = {
      data: [],
      size: 0
    },
        audio = {
      data: [],
      size: 0
    },
        timedMetadata = {
      data: [],
      size: 0
    },
        programMapTable,
        parsePes = function parsePes(payload, pes) {
      var ptsDtsFlags;
      var startPrefix = payload[0] << 16 | payload[1] << 8 | payload[2]; // default to an empty array

      pes.data = new Uint8Array(); // In certain live streams, the start of a TS fragment has ts packets
      // that are frame data that is continuing from the previous fragment. This
      // is to check that the pes data is the start of a new pes payload

      if (startPrefix !== 1) {
        return;
      } // get the packet length, this will be 0 for video


      pes.packetLength = 6 + (payload[4] << 8 | payload[5]); // find out if this packets starts a new keyframe

      pes.dataAlignmentIndicator = (payload[6] & 0x04) !== 0; // PES packets may be annotated with a PTS value, or a PTS value
      // and a DTS value. Determine what combination of values is
      // available to work with.

      ptsDtsFlags = payload[7]; // PTS and DTS are normally stored as a 33-bit number.  Javascript
      // performs all bitwise operations on 32-bit integers but javascript
      // supports a much greater range (52-bits) of integer using standard
      // mathematical operations.
      // We construct a 31-bit value using bitwise operators over the 31
      // most significant bits and then multiply by 4 (equal to a left-shift
      // of 2) before we add the final 2 least significant bits of the
      // timestamp (equal to an OR.)

      if (ptsDtsFlags & 0xC0) {
        // the PTS and DTS are not written out directly. For information
        // on how they are encoded, see
        // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
        pes.pts = (payload[9] & 0x0E) << 27 | (payload[10] & 0xFF) << 20 | (payload[11] & 0xFE) << 12 | (payload[12] & 0xFF) << 5 | (payload[13] & 0xFE) >>> 3;
        pes.pts *= 4; // Left shift by 2

        pes.pts += (payload[13] & 0x06) >>> 1; // OR by the two LSBs

        pes.dts = pes.pts;

        if (ptsDtsFlags & 0x40) {
          pes.dts = (payload[14] & 0x0E) << 27 | (payload[15] & 0xFF) << 20 | (payload[16] & 0xFE) << 12 | (payload[17] & 0xFF) << 5 | (payload[18] & 0xFE) >>> 3;
          pes.dts *= 4; // Left shift by 2

          pes.dts += (payload[18] & 0x06) >>> 1; // OR by the two LSBs
        }
      } // the data section starts immediately after the PES header.
      // pes_header_data_length specifies the number of header bytes
      // that follow the last byte of the field.


      pes.data = payload.subarray(9 + payload[8]);
    },

    /**
      * Pass completely parsed PES packets to the next stream in the pipeline
     **/
    flushStream = function flushStream(stream, type, forceFlush) {
      var packetData = new Uint8Array(stream.size),
          event = {
        type: type
      },
          i = 0,
          offset = 0,
          packetFlushable = false,
          fragment; // do nothing if there is not enough buffered data for a complete
      // PES header

      if (!stream.data.length || stream.size < 9) {
        return;
      }

      event.trackId = stream.data[0].pid; // reassemble the packet

      for (i = 0; i < stream.data.length; i++) {
        fragment = stream.data[i];
        packetData.set(fragment.data, offset);
        offset += fragment.data.byteLength;
      } // parse assembled packet's PES header


      parsePes(packetData, event); // non-video PES packets MUST have a non-zero PES_packet_length
      // check that there is enough stream data to fill the packet

      packetFlushable = type === 'video' || event.packetLength <= stream.size; // flush pending packets if the conditions are right

      if (forceFlush || packetFlushable) {
        stream.size = 0;
        stream.data.length = 0;
      } // only emit packets that are complete. this is to avoid assembling
      // incomplete PES packets due to poor segmentation


      if (packetFlushable) {
        self.trigger('data', event);
      }
    };

    _ElementaryStream.prototype.init.call(this);
    /**
     * Identifies M2TS packet types and parses PES packets using metadata
     * parsed from the PMT
     **/


    this.push = function (data) {
      ({
        pat: function pat() {// we have to wait for the PMT to arrive as well before we
          // have any meaningful metadata
        },
        pes: function pes() {
          var stream, streamType;

          switch (data.streamType) {
            case streamTypes.H264_STREAM_TYPE:
              stream = video;
              streamType = 'video';
              break;

            case streamTypes.ADTS_STREAM_TYPE:
              stream = audio;
              streamType = 'audio';
              break;

            case streamTypes.METADATA_STREAM_TYPE:
              stream = timedMetadata;
              streamType = 'timed-metadata';
              break;

            default:
              // ignore unknown stream types
              return;
          } // if a new packet is starting, we can flush the completed
          // packet


          if (data.payloadUnitStartIndicator) {
            flushStream(stream, streamType, true);
          } // buffer this fragment until we are sure we've received the
          // complete payload


          stream.data.push(data);
          stream.size += data.data.byteLength;
        },
        pmt: function pmt() {
          var event = {
            type: 'metadata',
            tracks: []
          };
          programMapTable = data.programMapTable; // translate audio and video streams to tracks

          if (programMapTable.video !== null) {
            event.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.video,
              codec: 'avc',
              type: 'video'
            });
          }

          if (programMapTable.audio !== null) {
            event.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.audio,
              codec: 'adts',
              type: 'audio'
            });
          }

          segmentHadPmt = true;
          self.trigger('data', event);
        }
      })[data.type]();
    };

    this.reset = function () {
      video.size = 0;
      video.data.length = 0;
      audio.size = 0;
      audio.data.length = 0;
      this.trigger('reset');
    };
    /**
     * Flush any remaining input. Video PES packets may be of variable
     * length. Normally, the start of a new video packet can trigger the
     * finalization of the previous packet. That is not possible if no
     * more video is forthcoming, however. In that case, some other
     * mechanism (like the end of the file) has to be employed. When it is
     * clear that no additional data is forthcoming, calling this method
     * will flush the buffered packets.
     */


    this.flushStreams_ = function () {
      // !!THIS ORDER IS IMPORTANT!!
      // video first then audio
      flushStream(video, 'video');
      flushStream(audio, 'audio');
      flushStream(timedMetadata, 'timed-metadata');
    };

    this.flush = function () {
      // if on flush we haven't had a pmt emitted
      // and we have a pmt to emit. emit the pmt
      // so that we trigger a trackinfo downstream.
      if (!segmentHadPmt && programMapTable) {
        var pmt = {
          type: 'metadata',
          tracks: []
        }; // translate audio and video streams to tracks

        if (programMapTable.video !== null) {
          pmt.tracks.push({
            timelineStartInfo: {
              baseMediaDecodeTime: 0
            },
            id: +programMapTable.video,
            codec: 'avc',
            type: 'video'
          });
        }

        if (programMapTable.audio !== null) {
          pmt.tracks.push({
            timelineStartInfo: {
              baseMediaDecodeTime: 0
            },
            id: +programMapTable.audio,
            codec: 'adts',
            type: 'audio'
          });
        }

        self.trigger('data', pmt);
      }

      segmentHadPmt = false;
      this.flushStreams_();
      this.trigger('done');
    };
  };

  _ElementaryStream.prototype = new stream();
  var m2ts = {
    PAT_PID: 0x0000,
    MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH$1,
    TransportPacketStream: _TransportPacketStream,
    TransportParseStream: _TransportParseStream,
    ElementaryStream: _ElementaryStream,
    TimestampRolloverStream: TimestampRolloverStream,
    CaptionStream: captionStream.CaptionStream,
    Cea608Stream: captionStream.Cea608Stream,
    Cea708Stream: captionStream.Cea708Stream,
    MetadataStream: metadataStream
  };

  for (var type in streamTypes) {
    if (streamTypes.hasOwnProperty(type)) {
      m2ts[type] = streamTypes[type];
    }
  }

  var m2ts_1 = m2ts;
  var ONE_SECOND_IN_TS$2 = clock.ONE_SECOND_IN_TS;

  var _AdtsStream;

  var ADTS_SAMPLING_FREQUENCIES$1 = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  /*
   * Accepts a ElementaryStream and emits data events with parsed
   * AAC Audio Frames of the individual packets. Input audio in ADTS
   * format is unpacked and re-emitted as AAC frames.
   *
   * @see http://wiki.multimedia.cx/index.php?title=ADTS
   * @see http://wiki.multimedia.cx/?title=Understanding_AAC
   */

  _AdtsStream = function AdtsStream(handlePartialSegments) {
    var buffer,
        frameNum = 0;

    _AdtsStream.prototype.init.call(this);

    this.skipWarn_ = function (start, end) {
      this.trigger('log', {
        level: 'warn',
        message: "adts skiping bytes " + start + " to " + end + " in frame " + frameNum + " outside syncword"
      });
    };

    this.push = function (packet) {
      var i = 0,
          frameLength,
          protectionSkipBytes,
          oldBuffer,
          sampleCount,
          adtsFrameDuration;

      if (!handlePartialSegments) {
        frameNum = 0;
      }

      if (packet.type !== 'audio') {
        // ignore non-audio data
        return;
      } // Prepend any data in the buffer to the input data so that we can parse
      // aac frames the cross a PES packet boundary


      if (buffer && buffer.length) {
        oldBuffer = buffer;
        buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
        buffer.set(oldBuffer);
        buffer.set(packet.data, oldBuffer.byteLength);
      } else {
        buffer = packet.data;
      } // unpack any ADTS frames which have been fully received
      // for details on the ADTS header, see http://wiki.multimedia.cx/index.php?title=ADTS


      var skip; // We use i + 7 here because we want to be able to parse the entire header.
      // If we don't have enough bytes to do that, then we definitely won't have a full frame.

      while (i + 7 < buffer.length) {
        // Look for the start of an ADTS header..
        if (buffer[i] !== 0xFF || (buffer[i + 1] & 0xF6) !== 0xF0) {
          if (typeof skip !== 'number') {
            skip = i;
          } // If a valid header was not found,  jump one forward and attempt to
          // find a valid ADTS header starting at the next byte


          i++;
          continue;
        }

        if (typeof skip === 'number') {
          this.skipWarn_(skip, i);
          skip = null;
        } // The protection skip bit tells us if we have 2 bytes of CRC data at the
        // end of the ADTS header


        protectionSkipBytes = (~buffer[i + 1] & 0x01) * 2; // Frame length is a 13 bit integer starting 16 bits from the
        // end of the sync sequence
        // NOTE: frame length includes the size of the header

        frameLength = (buffer[i + 3] & 0x03) << 11 | buffer[i + 4] << 3 | (buffer[i + 5] & 0xe0) >> 5;
        sampleCount = ((buffer[i + 6] & 0x03) + 1) * 1024;
        adtsFrameDuration = sampleCount * ONE_SECOND_IN_TS$2 / ADTS_SAMPLING_FREQUENCIES$1[(buffer[i + 2] & 0x3c) >>> 2]; // If we don't have enough data to actually finish this ADTS frame,
        // then we have to wait for more data

        if (buffer.byteLength - i < frameLength) {
          break;
        } // Otherwise, deliver the complete AAC frame


        this.trigger('data', {
          pts: packet.pts + frameNum * adtsFrameDuration,
          dts: packet.dts + frameNum * adtsFrameDuration,
          sampleCount: sampleCount,
          audioobjecttype: (buffer[i + 2] >>> 6 & 0x03) + 1,
          channelcount: (buffer[i + 2] & 1) << 2 | (buffer[i + 3] & 0xc0) >>> 6,
          samplerate: ADTS_SAMPLING_FREQUENCIES$1[(buffer[i + 2] & 0x3c) >>> 2],
          samplingfrequencyindex: (buffer[i + 2] & 0x3c) >>> 2,
          // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
          samplesize: 16,
          // data is the frame without it's header
          data: buffer.subarray(i + 7 + protectionSkipBytes, i + frameLength)
        });
        frameNum++;
        i += frameLength;
      }

      if (typeof skip === 'number') {
        this.skipWarn_(skip, i);
        skip = null;
      } // remove processed bytes from the buffer.


      buffer = buffer.subarray(i);
    };

    this.flush = function () {
      frameNum = 0;
      this.trigger('done');
    };

    this.reset = function () {
      buffer = void 0;
      this.trigger('reset');
    };

    this.endTimeline = function () {
      buffer = void 0;
      this.trigger('endedtimeline');
    };
  };

  _AdtsStream.prototype = new stream();
  var adts = _AdtsStream;
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var ExpGolomb;
  /**
   * Parser for exponential Golomb codes, a variable-bitwidth number encoding
   * scheme used by h264.
   */

  ExpGolomb = function ExpGolomb(workingData) {
    var // the number of bytes left to examine in workingData
    workingBytesAvailable = workingData.byteLength,
        // the current word being examined
    workingWord = 0,
        // :uint
    // the number of bits left to examine in the current word
    workingBitsAvailable = 0; // :uint;
    // ():uint

    this.length = function () {
      return 8 * workingBytesAvailable;
    }; // ():uint


    this.bitsAvailable = function () {
      return 8 * workingBytesAvailable + workingBitsAvailable;
    }; // ():void


    this.loadWord = function () {
      var position = workingData.byteLength - workingBytesAvailable,
          workingBytes = new Uint8Array(4),
          availableBytes = Math.min(4, workingBytesAvailable);

      if (availableBytes === 0) {
        throw new Error('no bytes available');
      }

      workingBytes.set(workingData.subarray(position, position + availableBytes));
      workingWord = new DataView(workingBytes.buffer).getUint32(0); // track the amount of workingData that has been processed

      workingBitsAvailable = availableBytes * 8;
      workingBytesAvailable -= availableBytes;
    }; // (count:int):void


    this.skipBits = function (count) {
      var skipBytes; // :int

      if (workingBitsAvailable > count) {
        workingWord <<= count;
        workingBitsAvailable -= count;
      } else {
        count -= workingBitsAvailable;
        skipBytes = Math.floor(count / 8);
        count -= skipBytes * 8;
        workingBytesAvailable -= skipBytes;
        this.loadWord();
        workingWord <<= count;
        workingBitsAvailable -= count;
      }
    }; // (size:int):uint


    this.readBits = function (size) {
      var bits = Math.min(workingBitsAvailable, size),
          // :uint
      valu = workingWord >>> 32 - bits; // :uint
      // if size > 31, handle error

      workingBitsAvailable -= bits;

      if (workingBitsAvailable > 0) {
        workingWord <<= bits;
      } else if (workingBytesAvailable > 0) {
        this.loadWord();
      }

      bits = size - bits;

      if (bits > 0) {
        return valu << bits | this.readBits(bits);
      }

      return valu;
    }; // ():uint


    this.skipLeadingZeros = function () {
      var leadingZeroCount; // :uint

      for (leadingZeroCount = 0; leadingZeroCount < workingBitsAvailable; ++leadingZeroCount) {
        if ((workingWord & 0x80000000 >>> leadingZeroCount) !== 0) {
          // the first bit of working word is 1
          workingWord <<= leadingZeroCount;
          workingBitsAvailable -= leadingZeroCount;
          return leadingZeroCount;
        }
      } // we exhausted workingWord and still have not found a 1


      this.loadWord();
      return leadingZeroCount + this.skipLeadingZeros();
    }; // ():void


    this.skipUnsignedExpGolomb = function () {
      this.skipBits(1 + this.skipLeadingZeros());
    }; // ():void


    this.skipExpGolomb = function () {
      this.skipBits(1 + this.skipLeadingZeros());
    }; // ():uint


    this.readUnsignedExpGolomb = function () {
      var clz = this.skipLeadingZeros(); // :uint

      return this.readBits(clz + 1) - 1;
    }; // ():int


    this.readExpGolomb = function () {
      var valu = this.readUnsignedExpGolomb(); // :int

      if (0x01 & valu) {
        // the number is odd if the low order bit is set
        return 1 + valu >>> 1; // add 1 to make it even, and divide by 2
      }

      return -1 * (valu >>> 1); // divide by two then make it negative
    }; // Some convenience functions
    // :Boolean


    this.readBoolean = function () {
      return this.readBits(1) === 1;
    }; // ():int


    this.readUnsignedByte = function () {
      return this.readBits(8);
    };

    this.loadWord();
  };

  var expGolomb = ExpGolomb;

  var _H264Stream, _NalByteStream;

  var PROFILES_WITH_OPTIONAL_SPS_DATA;
  /**
   * Accepts a NAL unit byte stream and unpacks the embedded NAL units.
   */

  _NalByteStream = function NalByteStream() {
    var syncPoint = 0,
        i,
        buffer;

    _NalByteStream.prototype.init.call(this);
    /*
     * Scans a byte stream and triggers a data event with the NAL units found.
     * @param {Object} data Event received from H264Stream
     * @param {Uint8Array} data.data The h264 byte stream to be scanned
     *
     * @see H264Stream.push
     */


    this.push = function (data) {
      var swapBuffer;

      if (!buffer) {
        buffer = data.data;
      } else {
        swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
        swapBuffer.set(buffer);
        swapBuffer.set(data.data, buffer.byteLength);
        buffer = swapBuffer;
      }

      var len = buffer.byteLength; // Rec. ITU-T H.264, Annex B
      // scan for NAL unit boundaries
      // a match looks like this:
      // 0 0 1 .. NAL .. 0 0 1
      // ^ sync point        ^ i
      // or this:
      // 0 0 1 .. NAL .. 0 0 0
      // ^ sync point        ^ i
      // advance the sync point to a NAL start, if necessary

      for (; syncPoint < len - 3; syncPoint++) {
        if (buffer[syncPoint + 2] === 1) {
          // the sync point is properly aligned
          i = syncPoint + 5;
          break;
        }
      }

      while (i < len) {
        // look at the current byte to determine if we've hit the end of
        // a NAL unit boundary
        switch (buffer[i]) {
          case 0:
            // skip past non-sync sequences
            if (buffer[i - 1] !== 0) {
              i += 2;
              break;
            } else if (buffer[i - 2] !== 0) {
              i++;
              break;
            } // deliver the NAL unit if it isn't empty


            if (syncPoint + 3 !== i - 2) {
              this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
            } // drop trailing zeroes


            do {
              i++;
            } while (buffer[i] !== 1 && i < len);

            syncPoint = i - 2;
            i += 3;
            break;

          case 1:
            // skip past non-sync sequences
            if (buffer[i - 1] !== 0 || buffer[i - 2] !== 0) {
              i += 3;
              break;
            } // deliver the NAL unit


            this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
            syncPoint = i - 2;
            i += 3;
            break;

          default:
            // the current byte isn't a one or zero, so it cannot be part
            // of a sync sequence
            i += 3;
            break;
        }
      } // filter out the NAL units that were delivered


      buffer = buffer.subarray(syncPoint);
      i -= syncPoint;
      syncPoint = 0;
    };

    this.reset = function () {
      buffer = null;
      syncPoint = 0;
      this.trigger('reset');
    };

    this.flush = function () {
      // deliver the last buffered NAL unit
      if (buffer && buffer.byteLength > 3) {
        this.trigger('data', buffer.subarray(syncPoint + 3));
      } // reset the stream state


      buffer = null;
      syncPoint = 0;
      this.trigger('done');
    };

    this.endTimeline = function () {
      this.flush();
      this.trigger('endedtimeline');
    };
  };

  _NalByteStream.prototype = new stream(); // values of profile_idc that indicate additional fields are included in the SPS
  // see Recommendation ITU-T H.264 (4/2013),
  // 7.3.2.1.1 Sequence parameter set data syntax

  PROFILES_WITH_OPTIONAL_SPS_DATA = {
    100: true,
    110: true,
    122: true,
    244: true,
    44: true,
    83: true,
    86: true,
    118: true,
    128: true,
    // TODO: the three profiles below don't
    // appear to have sps data in the specificiation anymore?
    138: true,
    139: true,
    134: true
  };
  /**
   * Accepts input from a ElementaryStream and produces H.264 NAL unit data
   * events.
   */

  _H264Stream = function H264Stream() {
    var nalByteStream = new _NalByteStream(),
        self,
        trackId,
        currentPts,
        currentDts,
        discardEmulationPreventionBytes,
        readSequenceParameterSet,
        skipScalingList;

    _H264Stream.prototype.init.call(this);

    self = this;
    /*
     * Pushes a packet from a stream onto the NalByteStream
     *
     * @param {Object} packet - A packet received from a stream
     * @param {Uint8Array} packet.data - The raw bytes of the packet
     * @param {Number} packet.dts - Decode timestamp of the packet
     * @param {Number} packet.pts - Presentation timestamp of the packet
     * @param {Number} packet.trackId - The id of the h264 track this packet came from
     * @param {('video'|'audio')} packet.type - The type of packet
     *
     */

    this.push = function (packet) {
      if (packet.type !== 'video') {
        return;
      }

      trackId = packet.trackId;
      currentPts = packet.pts;
      currentDts = packet.dts;
      nalByteStream.push(packet);
    };
    /*
     * Identify NAL unit types and pass on the NALU, trackId, presentation and decode timestamps
     * for the NALUs to the next stream component.
     * Also, preprocess caption and sequence parameter NALUs.
     *
     * @param {Uint8Array} data - A NAL unit identified by `NalByteStream.push`
     * @see NalByteStream.push
     */


    nalByteStream.on('data', function (data) {
      var event = {
        trackId: trackId,
        pts: currentPts,
        dts: currentDts,
        data: data,
        nalUnitTypeCode: data[0] & 0x1f
      };

      switch (event.nalUnitTypeCode) {
        case 0x05:
          event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
          break;

        case 0x06:
          event.nalUnitType = 'sei_rbsp';
          event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
          break;

        case 0x07:
          event.nalUnitType = 'seq_parameter_set_rbsp';
          event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
          event.config = readSequenceParameterSet(event.escapedRBSP);
          break;

        case 0x08:
          event.nalUnitType = 'pic_parameter_set_rbsp';
          break;

        case 0x09:
          event.nalUnitType = 'access_unit_delimiter_rbsp';
          break;
      } // This triggers data on the H264Stream


      self.trigger('data', event);
    });
    nalByteStream.on('done', function () {
      self.trigger('done');
    });
    nalByteStream.on('partialdone', function () {
      self.trigger('partialdone');
    });
    nalByteStream.on('reset', function () {
      self.trigger('reset');
    });
    nalByteStream.on('endedtimeline', function () {
      self.trigger('endedtimeline');
    });

    this.flush = function () {
      nalByteStream.flush();
    };

    this.partialFlush = function () {
      nalByteStream.partialFlush();
    };

    this.reset = function () {
      nalByteStream.reset();
    };

    this.endTimeline = function () {
      nalByteStream.endTimeline();
    };
    /**
     * Advance the ExpGolomb decoder past a scaling list. The scaling
     * list is optionally transmitted as part of a sequence parameter
     * set and is not relevant to transmuxing.
     * @param count {number} the number of entries in this scaling list
     * @param expGolombDecoder {object} an ExpGolomb pointed to the
     * start of a scaling list
     * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
     */


    skipScalingList = function skipScalingList(count, expGolombDecoder) {
      var lastScale = 8,
          nextScale = 8,
          j,
          deltaScale;

      for (j = 0; j < count; j++) {
        if (nextScale !== 0) {
          deltaScale = expGolombDecoder.readExpGolomb();
          nextScale = (lastScale + deltaScale + 256) % 256;
        }

        lastScale = nextScale === 0 ? lastScale : nextScale;
      }
    };
    /**
     * Expunge any "Emulation Prevention" bytes from a "Raw Byte
     * Sequence Payload"
     * @param data {Uint8Array} the bytes of a RBSP from a NAL
     * unit
     * @return {Uint8Array} the RBSP without any Emulation
     * Prevention Bytes
     */


    discardEmulationPreventionBytes = function discardEmulationPreventionBytes(data) {
      var length = data.byteLength,
          emulationPreventionBytesPositions = [],
          i = 1,
          newLength,
          newData; // Find all `Emulation Prevention Bytes`

      while (i < length - 2) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
          emulationPreventionBytesPositions.push(i + 2);
          i += 2;
        } else {
          i++;
        }
      } // If no Emulation Prevention Bytes were found just return the original
      // array


      if (emulationPreventionBytesPositions.length === 0) {
        return data;
      } // Create a new array to hold the NAL unit data


      newLength = length - emulationPreventionBytesPositions.length;
      newData = new Uint8Array(newLength);
      var sourceIndex = 0;

      for (i = 0; i < newLength; sourceIndex++, i++) {
        if (sourceIndex === emulationPreventionBytesPositions[0]) {
          // Skip this byte
          sourceIndex++; // Remove this position index

          emulationPreventionBytesPositions.shift();
        }

        newData[i] = data[sourceIndex];
      }

      return newData;
    };
    /**
     * Read a sequence parameter set and return some interesting video
     * properties. A sequence parameter set is the H264 metadata that
     * describes the properties of upcoming video frames.
     * @param data {Uint8Array} the bytes of a sequence parameter set
     * @return {object} an object with configuration parsed from the
     * sequence parameter set, including the dimensions of the
     * associated video frames.
     */


    readSequenceParameterSet = function readSequenceParameterSet(data) {
      var frameCropLeftOffset = 0,
          frameCropRightOffset = 0,
          frameCropTopOffset = 0,
          frameCropBottomOffset = 0,
          expGolombDecoder,
          profileIdc,
          levelIdc,
          profileCompatibility,
          chromaFormatIdc,
          picOrderCntType,
          numRefFramesInPicOrderCntCycle,
          picWidthInMbsMinus1,
          picHeightInMapUnitsMinus1,
          frameMbsOnlyFlag,
          scalingListCount,
          sarRatio = [1, 1],
          aspectRatioIdc,
          i;
      expGolombDecoder = new expGolomb(data);
      profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc

      profileCompatibility = expGolombDecoder.readUnsignedByte(); // constraint_set[0-5]_flag

      levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)

      expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id
      // some profiles have more optional data we don't need

      if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
        chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();

        if (chromaFormatIdc === 3) {
          expGolombDecoder.skipBits(1); // separate_colour_plane_flag
        }

        expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8

        expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8

        expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag

        if (expGolombDecoder.readBoolean()) {
          // seq_scaling_matrix_present_flag
          scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;

          for (i = 0; i < scalingListCount; i++) {
            if (expGolombDecoder.readBoolean()) {
              // seq_scaling_list_present_flag[ i ]
              if (i < 6) {
                skipScalingList(16, expGolombDecoder);
              } else {
                skipScalingList(64, expGolombDecoder);
              }
            }
          }
        }
      }

      expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4

      picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

      if (picOrderCntType === 0) {
        expGolombDecoder.readUnsignedExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
      } else if (picOrderCntType === 1) {
        expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag

        expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic

        expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field

        numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();

        for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
          expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
        }
      }

      expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames

      expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

      picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
      picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
      frameMbsOnlyFlag = expGolombDecoder.readBits(1);

      if (frameMbsOnlyFlag === 0) {
        expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
      }

      expGolombDecoder.skipBits(1); // direct_8x8_inference_flag

      if (expGolombDecoder.readBoolean()) {
        // frame_cropping_flag
        frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
      }

      if (expGolombDecoder.readBoolean()) {
        // vui_parameters_present_flag
        if (expGolombDecoder.readBoolean()) {
          // aspect_ratio_info_present_flag
          aspectRatioIdc = expGolombDecoder.readUnsignedByte();

          switch (aspectRatioIdc) {
            case 1:
              sarRatio = [1, 1];
              break;

            case 2:
              sarRatio = [12, 11];
              break;

            case 3:
              sarRatio = [10, 11];
              break;

            case 4:
              sarRatio = [16, 11];
              break;

            case 5:
              sarRatio = [40, 33];
              break;

            case 6:
              sarRatio = [24, 11];
              break;

            case 7:
              sarRatio = [20, 11];
              break;

            case 8:
              sarRatio = [32, 11];
              break;

            case 9:
              sarRatio = [80, 33];
              break;

            case 10:
              sarRatio = [18, 11];
              break;

            case 11:
              sarRatio = [15, 11];
              break;

            case 12:
              sarRatio = [64, 33];
              break;

            case 13:
              sarRatio = [160, 99];
              break;

            case 14:
              sarRatio = [4, 3];
              break;

            case 15:
              sarRatio = [3, 2];
              break;

            case 16:
              sarRatio = [2, 1];
              break;

            case 255:
              {
                sarRatio = [expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte(), expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte()];
                break;
              }
          }

          if (sarRatio) {
            sarRatio[0] / sarRatio[1];
          }
        }
      }

      return {
        profileIdc: profileIdc,
        levelIdc: levelIdc,
        profileCompatibility: profileCompatibility,
        width: (picWidthInMbsMinus1 + 1) * 16 - frameCropLeftOffset * 2 - frameCropRightOffset * 2,
        height: (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - frameCropTopOffset * 2 - frameCropBottomOffset * 2,
        // sar is sample aspect ratio
        sarRatio: sarRatio
      };
    };
  };

  _H264Stream.prototype = new stream();
  var h264 = {
    H264Stream: _H264Stream,
    NalByteStream: _NalByteStream
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * Utilities to detect basic properties and metadata about Aac data.
   */

  var ADTS_SAMPLING_FREQUENCIES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  var parseId3TagSize = function parseId3TagSize(header, byteIndex) {
    var returnSize = header[byteIndex + 6] << 21 | header[byteIndex + 7] << 14 | header[byteIndex + 8] << 7 | header[byteIndex + 9],
        flags = header[byteIndex + 5],
        footerPresent = (flags & 16) >> 4; // if we get a negative returnSize clamp it to 0

    returnSize = returnSize >= 0 ? returnSize : 0;

    if (footerPresent) {
      return returnSize + 20;
    }

    return returnSize + 10;
  };

  var getId3Offset = function getId3Offset(data, offset) {
    if (data.length - offset < 10 || data[offset] !== 'I'.charCodeAt(0) || data[offset + 1] !== 'D'.charCodeAt(0) || data[offset + 2] !== '3'.charCodeAt(0)) {
      return offset;
    }

    offset += parseId3TagSize(data, offset);
    return getId3Offset(data, offset);
  }; // TODO: use vhs-utils


  var isLikelyAacData$1 = function isLikelyAacData(data) {
    var offset = getId3Offset(data, 0);
    return data.length >= offset + 2 && (data[offset] & 0xFF) === 0xFF && (data[offset + 1] & 0xF0) === 0xF0 && // verify that the 2 layer bits are 0, aka this
    // is not mp3 data but aac data.
    (data[offset + 1] & 0x16) === 0x10;
  };

  var parseSyncSafeInteger = function parseSyncSafeInteger(data) {
    return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
  }; // return a percent-encoded representation of the specified byte range
  // @see http://en.wikipedia.org/wiki/Percent-encoding


  var percentEncode = function percentEncode(bytes, start, end) {
    var i,
        result = '';

    for (i = start; i < end; i++) {
      result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
    }

    return result;
  }; // return the string representation of the specified byte range,
  // interpreted as ISO-8859-1.


  var parseIso88591 = function parseIso88591(bytes, start, end) {
    return unescape(percentEncode(bytes, start, end)); // jshint ignore:line
  };

  var parseAdtsSize = function parseAdtsSize(header, byteIndex) {
    var lowThree = (header[byteIndex + 5] & 0xE0) >> 5,
        middle = header[byteIndex + 4] << 3,
        highTwo = header[byteIndex + 3] & 0x3 << 11;
    return highTwo | middle | lowThree;
  };

  var parseType$2 = function parseType(header, byteIndex) {
    if (header[byteIndex] === 'I'.charCodeAt(0) && header[byteIndex + 1] === 'D'.charCodeAt(0) && header[byteIndex + 2] === '3'.charCodeAt(0)) {
      return 'timed-metadata';
    } else if (header[byteIndex] & 0xff === 0xff && (header[byteIndex + 1] & 0xf0) === 0xf0) {
      return 'audio';
    }

    return null;
  };

  var parseSampleRate = function parseSampleRate(packet) {
    var i = 0;

    while (i + 5 < packet.length) {
      if (packet[i] !== 0xFF || (packet[i + 1] & 0xF6) !== 0xF0) {
        // If a valid header was not found,  jump one forward and attempt to
        // find a valid ADTS header starting at the next byte
        i++;
        continue;
      }

      return ADTS_SAMPLING_FREQUENCIES[(packet[i + 2] & 0x3c) >>> 2];
    }

    return null;
  };

  var parseAacTimestamp = function parseAacTimestamp(packet) {
    var frameStart, frameSize, frame, frameHeader; // find the start of the first frame and the end of the tag

    frameStart = 10;

    if (packet[5] & 0x40) {
      // advance the frame start past the extended header
      frameStart += 4; // header size field

      frameStart += parseSyncSafeInteger(packet.subarray(10, 14));
    } // parse one or more ID3 frames
    // http://id3.org/id3v2.3.0#ID3v2_frame_overview


    do {
      // determine the number of bytes in this frame
      frameSize = parseSyncSafeInteger(packet.subarray(frameStart + 4, frameStart + 8));

      if (frameSize < 1) {
        return null;
      }

      frameHeader = String.fromCharCode(packet[frameStart], packet[frameStart + 1], packet[frameStart + 2], packet[frameStart + 3]);

      if (frameHeader === 'PRIV') {
        frame = packet.subarray(frameStart + 10, frameStart + frameSize + 10);

        for (var i = 0; i < frame.byteLength; i++) {
          if (frame[i] === 0) {
            var owner = parseIso88591(frame, 0, i);

            if (owner === 'com.apple.streaming.transportStreamTimestamp') {
              var d = frame.subarray(i + 1);
              var size = (d[3] & 0x01) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
              size *= 4;
              size += d[7] & 0x03;
              return size;
            }

            break;
          }
        }
      }

      frameStart += 10; // advance past the frame header

      frameStart += frameSize; // advance past the frame body
    } while (frameStart < packet.byteLength);

    return null;
  };

  var utils = {
    isLikelyAacData: isLikelyAacData$1,
    parseId3TagSize: parseId3TagSize,
    parseAdtsSize: parseAdtsSize,
    parseType: parseType$2,
    parseSampleRate: parseSampleRate,
    parseAacTimestamp: parseAacTimestamp
  };

  var _AacStream;
  /**
   * Splits an incoming stream of binary data into ADTS and ID3 Frames.
   */


  _AacStream = function AacStream() {
    var everything = new Uint8Array(),
        timeStamp = 0;

    _AacStream.prototype.init.call(this);

    this.setTimestamp = function (timestamp) {
      timeStamp = timestamp;
    };

    this.push = function (bytes) {
      var frameSize = 0,
          byteIndex = 0,
          bytesLeft,
          chunk,
          packet,
          tempLength; // If there are bytes remaining from the last segment, prepend them to the
      // bytes that were pushed in

      if (everything.length) {
        tempLength = everything.length;
        everything = new Uint8Array(bytes.byteLength + tempLength);
        everything.set(everything.subarray(0, tempLength));
        everything.set(bytes, tempLength);
      } else {
        everything = bytes;
      }

      while (everything.length - byteIndex >= 3) {
        if (everything[byteIndex] === 'I'.charCodeAt(0) && everything[byteIndex + 1] === 'D'.charCodeAt(0) && everything[byteIndex + 2] === '3'.charCodeAt(0)) {
          // Exit early because we don't have enough to parse
          // the ID3 tag header
          if (everything.length - byteIndex < 10) {
            break;
          } // check framesize


          frameSize = utils.parseId3TagSize(everything, byteIndex); // Exit early if we don't have enough in the buffer
          // to emit a full packet
          // Add to byteIndex to support multiple ID3 tags in sequence

          if (byteIndex + frameSize > everything.length) {
            break;
          }

          chunk = {
            type: 'timed-metadata',
            data: everything.subarray(byteIndex, byteIndex + frameSize)
          };
          this.trigger('data', chunk);
          byteIndex += frameSize;
          continue;
        } else if ((everything[byteIndex] & 0xff) === 0xff && (everything[byteIndex + 1] & 0xf0) === 0xf0) {
          // Exit early because we don't have enough to parse
          // the ADTS frame header
          if (everything.length - byteIndex < 7) {
            break;
          }

          frameSize = utils.parseAdtsSize(everything, byteIndex); // Exit early if we don't have enough in the buffer
          // to emit a full packet

          if (byteIndex + frameSize > everything.length) {
            break;
          }

          packet = {
            type: 'audio',
            data: everything.subarray(byteIndex, byteIndex + frameSize),
            pts: timeStamp,
            dts: timeStamp
          };
          this.trigger('data', packet);
          byteIndex += frameSize;
          continue;
        }

        byteIndex++;
      }

      bytesLeft = everything.length - byteIndex;

      if (bytesLeft > 0) {
        everything = everything.subarray(byteIndex);
      } else {
        everything = new Uint8Array();
      }
    };

    this.reset = function () {
      everything = new Uint8Array();
      this.trigger('reset');
    };

    this.endTimeline = function () {
      everything = new Uint8Array();
      this.trigger('endedtimeline');
    };
  };

  _AacStream.prototype = new stream();
  var aac = _AacStream; // constants

  var AUDIO_PROPERTIES = ['audioobjecttype', 'channelcount', 'samplerate', 'samplingfrequencyindex', 'samplesize'];
  var audioProperties = AUDIO_PROPERTIES;
  var VIDEO_PROPERTIES = ['width', 'height', 'profileIdc', 'levelIdc', 'profileCompatibility', 'sarRatio'];
  var videoProperties = VIDEO_PROPERTIES;
  var H264Stream = h264.H264Stream;
  var isLikelyAacData = utils.isLikelyAacData;
  var ONE_SECOND_IN_TS$1 = clock.ONE_SECOND_IN_TS; // object types

  var _VideoSegmentStream, _AudioSegmentStream, _Transmuxer, _CoalesceStream;

  var retriggerForStream = function retriggerForStream(key, event) {
    event.stream = key;
    this.trigger('log', event);
  };

  var addPipelineLogRetriggers = function addPipelineLogRetriggers(transmuxer, pipeline) {
    var keys = Object.keys(pipeline);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]; // skip non-stream keys and headOfPipeline
      // which is just a duplicate

      if (key === 'headOfPipeline' || !pipeline[key].on) {
        continue;
      }

      pipeline[key].on('log', retriggerForStream.bind(transmuxer, key));
    }
  };
  /**
   * Compare two arrays (even typed) for same-ness
   */


  var arrayEquals = function arrayEquals(a, b) {
    var i;

    if (a.length !== b.length) {
      return false;
    } // compare the value of each element in the array


    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  };

  var generateSegmentTimingInfo = function generateSegmentTimingInfo(baseMediaDecodeTime, startDts, startPts, endDts, endPts, prependedContentDuration) {
    var ptsOffsetFromDts = startPts - startDts,
        decodeDuration = endDts - startDts,
        presentationDuration = endPts - startPts; // The PTS and DTS values are based on the actual stream times from the segment,
    // however, the player time values will reflect a start from the baseMediaDecodeTime.
    // In order to provide relevant values for the player times, base timing info on the
    // baseMediaDecodeTime and the DTS and PTS durations of the segment.

    return {
      start: {
        dts: baseMediaDecodeTime,
        pts: baseMediaDecodeTime + ptsOffsetFromDts
      },
      end: {
        dts: baseMediaDecodeTime + decodeDuration,
        pts: baseMediaDecodeTime + presentationDuration
      },
      prependedContentDuration: prependedContentDuration,
      baseMediaDecodeTime: baseMediaDecodeTime
    };
  };
  /**
   * Constructs a single-track, ISO BMFF media segment from AAC data
   * events. The output of this stream can be fed to a SourceBuffer
   * configured with a suitable initialization segment.
   * @param track {object} track metadata configuration
   * @param options {object} transmuxer options object
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */


  _AudioSegmentStream = function AudioSegmentStream(track, options) {
    var adtsFrames = [],
        sequenceNumber,
        earliestAllowedDts = 0,
        audioAppendStartTs = 0,
        videoBaseMediaDecodeTime = Infinity;
    options = options || {};
    sequenceNumber = options.firstSequenceNumber || 0;

    _AudioSegmentStream.prototype.init.call(this);

    this.push = function (data) {
      trackDecodeInfo.collectDtsInfo(track, data);

      if (track) {
        audioProperties.forEach(function (prop) {
          track[prop] = data[prop];
        });
      } // buffer audio data until end() is called


      adtsFrames.push(data);
    };

    this.setEarliestDts = function (earliestDts) {
      earliestAllowedDts = earliestDts;
    };

    this.setVideoBaseMediaDecodeTime = function (baseMediaDecodeTime) {
      videoBaseMediaDecodeTime = baseMediaDecodeTime;
    };

    this.setAudioAppendStart = function (timestamp) {
      audioAppendStartTs = timestamp;
    };

    this.flush = function () {
      var frames, moof, mdat, boxes, frameDuration, segmentDuration, videoClockCyclesOfSilencePrefixed; // return early if no audio data has been observed

      if (adtsFrames.length === 0) {
        this.trigger('done', 'AudioSegmentStream');
        return;
      }

      frames = audioFrameUtils.trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts);
      track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps); // amount of audio filled but the value is in video clock rather than audio clock

      videoClockCyclesOfSilencePrefixed = audioFrameUtils.prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime); // we have to build the index from byte locations to
      // samples (that is, adts frames) in the audio data

      track.samples = audioFrameUtils.generateSampleTable(frames); // concatenate the audio data to constuct the mdat

      mdat = mp4Generator.mdat(audioFrameUtils.concatenateFrameData(frames));
      adtsFrames = [];
      moof = mp4Generator.moof(sequenceNumber, [track]);
      boxes = new Uint8Array(moof.byteLength + mdat.byteLength); // bump the sequence number for next time

      sequenceNumber++;
      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);
      trackDecodeInfo.clearDtsInfo(track);
      frameDuration = Math.ceil(ONE_SECOND_IN_TS$1 * 1024 / track.samplerate); // TODO this check was added to maintain backwards compatibility (particularly with
      // tests) on adding the timingInfo event. However, it seems unlikely that there's a
      // valid use-case where an init segment/data should be triggered without associated
      // frames. Leaving for now, but should be looked into.

      if (frames.length) {
        segmentDuration = frames.length * frameDuration;
        this.trigger('segmentTimingInfo', generateSegmentTimingInfo( // The audio track's baseMediaDecodeTime is in audio clock cycles, but the
        // frame info is in video clock cycles. Convert to match expectation of
        // listeners (that all timestamps will be based on video clock cycles).
        clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate), // frame times are already in video clock, as is segment duration
        frames[0].dts, frames[0].pts, frames[0].dts + segmentDuration, frames[0].pts + segmentDuration, videoClockCyclesOfSilencePrefixed || 0));
        this.trigger('timingInfo', {
          start: frames[0].pts,
          end: frames[0].pts + segmentDuration
        });
      }

      this.trigger('data', {
        track: track,
        boxes: boxes
      });
      this.trigger('done', 'AudioSegmentStream');
    };

    this.reset = function () {
      trackDecodeInfo.clearDtsInfo(track);
      adtsFrames = [];
      this.trigger('reset');
    };
  };

  _AudioSegmentStream.prototype = new stream();
  /**
   * Constructs a single-track, ISO BMFF media segment from H264 data
   * events. The output of this stream can be fed to a SourceBuffer
   * configured with a suitable initialization segment.
   * @param track {object} track metadata configuration
   * @param options {object} transmuxer options object
   * @param options.alignGopsAtEnd {boolean} If true, start from the end of the
   *        gopsToAlignWith list when attempting to align gop pts
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */

  _VideoSegmentStream = function VideoSegmentStream(track, options) {
    var sequenceNumber,
        nalUnits = [],
        gopsToAlignWith = [],
        config,
        pps;
    options = options || {};
    sequenceNumber = options.firstSequenceNumber || 0;

    _VideoSegmentStream.prototype.init.call(this);

    delete track.minPTS;
    this.gopCache_ = [];
    /**
      * Constructs a ISO BMFF segment given H264 nalUnits
      * @param {Object} nalUnit A data event representing a nalUnit
      * @param {String} nalUnit.nalUnitType
      * @param {Object} nalUnit.config Properties for a mp4 track
      * @param {Uint8Array} nalUnit.data The nalUnit bytes
      * @see lib/codecs/h264.js
     **/

    this.push = function (nalUnit) {
      trackDecodeInfo.collectDtsInfo(track, nalUnit); // record the track config

      if (nalUnit.nalUnitType === 'seq_parameter_set_rbsp' && !config) {
        config = nalUnit.config;
        track.sps = [nalUnit.data];
        videoProperties.forEach(function (prop) {
          track[prop] = config[prop];
        }, this);
      }

      if (nalUnit.nalUnitType === 'pic_parameter_set_rbsp' && !pps) {
        pps = nalUnit.data;
        track.pps = [nalUnit.data];
      } // buffer video until flush() is called


      nalUnits.push(nalUnit);
    };
    /**
      * Pass constructed ISO BMFF track and boxes on to the
      * next stream in the pipeline
     **/


    this.flush = function () {
      var frames,
          gopForFusion,
          gops,
          moof,
          mdat,
          boxes,
          prependedContentDuration = 0,
          firstGop,
          lastGop; // Throw away nalUnits at the start of the byte stream until
      // we find the first AUD

      while (nalUnits.length) {
        if (nalUnits[0].nalUnitType === 'access_unit_delimiter_rbsp') {
          break;
        }

        nalUnits.shift();
      } // Return early if no video data has been observed


      if (nalUnits.length === 0) {
        this.resetStream_();
        this.trigger('done', 'VideoSegmentStream');
        return;
      } // Organize the raw nal-units into arrays that represent
      // higher-level constructs such as frames and gops
      // (group-of-pictures)


      frames = frameUtils.groupNalsIntoFrames(nalUnits);
      gops = frameUtils.groupFramesIntoGops(frames); // If the first frame of this fragment is not a keyframe we have
      // a problem since MSE (on Chrome) requires a leading keyframe.
      //
      // We have two approaches to repairing this situation:
      // 1) GOP-FUSION:
      //    This is where we keep track of the GOPS (group-of-pictures)
      //    from previous fragments and attempt to find one that we can
      //    prepend to the current fragment in order to create a valid
      //    fragment.
      // 2) KEYFRAME-PULLING:
      //    Here we search for the first keyframe in the fragment and
      //    throw away all the frames between the start of the fragment
      //    and that keyframe. We then extend the duration and pull the
      //    PTS of the keyframe forward so that it covers the time range
      //    of the frames that were disposed of.
      //
      // #1 is far prefereable over #2 which can cause "stuttering" but
      // requires more things to be just right.

      if (!gops[0][0].keyFrame) {
        // Search for a gop for fusion from our gopCache
        gopForFusion = this.getGopForFusion_(nalUnits[0], track);

        if (gopForFusion) {
          // in order to provide more accurate timing information about the segment, save
          // the number of seconds prepended to the original segment due to GOP fusion
          prependedContentDuration = gopForFusion.duration;
          gops.unshift(gopForFusion); // Adjust Gops' metadata to account for the inclusion of the
          // new gop at the beginning

          gops.byteLength += gopForFusion.byteLength;
          gops.nalCount += gopForFusion.nalCount;
          gops.pts = gopForFusion.pts;
          gops.dts = gopForFusion.dts;
          gops.duration += gopForFusion.duration;
        } else {
          // If we didn't find a candidate gop fall back to keyframe-pulling
          gops = frameUtils.extendFirstKeyFrame(gops);
        }
      } // Trim gops to align with gopsToAlignWith


      if (gopsToAlignWith.length) {
        var alignedGops;

        if (options.alignGopsAtEnd) {
          alignedGops = this.alignGopsAtEnd_(gops);
        } else {
          alignedGops = this.alignGopsAtStart_(gops);
        }

        if (!alignedGops) {
          // save all the nals in the last GOP into the gop cache
          this.gopCache_.unshift({
            gop: gops.pop(),
            pps: track.pps,
            sps: track.sps
          }); // Keep a maximum of 6 GOPs in the cache

          this.gopCache_.length = Math.min(6, this.gopCache_.length); // Clear nalUnits

          nalUnits = []; // return early no gops can be aligned with desired gopsToAlignWith

          this.resetStream_();
          this.trigger('done', 'VideoSegmentStream');
          return;
        } // Some gops were trimmed. clear dts info so minSegmentDts and pts are correct
        // when recalculated before sending off to CoalesceStream


        trackDecodeInfo.clearDtsInfo(track);
        gops = alignedGops;
      }

      trackDecodeInfo.collectDtsInfo(track, gops); // First, we have to build the index from byte locations to
      // samples (that is, frames) in the video data

      track.samples = frameUtils.generateSampleTable(gops); // Concatenate the video data and construct the mdat

      mdat = mp4Generator.mdat(frameUtils.concatenateNalData(gops));
      track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
      this.trigger('processedGopsInfo', gops.map(function (gop) {
        return {
          pts: gop.pts,
          dts: gop.dts,
          byteLength: gop.byteLength
        };
      }));
      firstGop = gops[0];
      lastGop = gops[gops.length - 1];
      this.trigger('segmentTimingInfo', generateSegmentTimingInfo(track.baseMediaDecodeTime, firstGop.dts, firstGop.pts, lastGop.dts + lastGop.duration, lastGop.pts + lastGop.duration, prependedContentDuration));
      this.trigger('timingInfo', {
        start: gops[0].pts,
        end: gops[gops.length - 1].pts + gops[gops.length - 1].duration
      }); // save all the nals in the last GOP into the gop cache

      this.gopCache_.unshift({
        gop: gops.pop(),
        pps: track.pps,
        sps: track.sps
      }); // Keep a maximum of 6 GOPs in the cache

      this.gopCache_.length = Math.min(6, this.gopCache_.length); // Clear nalUnits

      nalUnits = [];
      this.trigger('baseMediaDecodeTime', track.baseMediaDecodeTime);
      this.trigger('timelineStartInfo', track.timelineStartInfo);
      moof = mp4Generator.moof(sequenceNumber, [track]); // it would be great to allocate this array up front instead of
      // throwing away hundreds of media segment fragments

      boxes = new Uint8Array(moof.byteLength + mdat.byteLength); // Bump the sequence number for next time

      sequenceNumber++;
      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);
      this.trigger('data', {
        track: track,
        boxes: boxes
      });
      this.resetStream_(); // Continue with the flush process now

      this.trigger('done', 'VideoSegmentStream');
    };

    this.reset = function () {
      this.resetStream_();
      nalUnits = [];
      this.gopCache_.length = 0;
      gopsToAlignWith.length = 0;
      this.trigger('reset');
    };

    this.resetStream_ = function () {
      trackDecodeInfo.clearDtsInfo(track); // reset config and pps because they may differ across segments
      // for instance, when we are rendition switching

      config = undefined;
      pps = undefined;
    }; // Search for a candidate Gop for gop-fusion from the gop cache and
    // return it or return null if no good candidate was found


    this.getGopForFusion_ = function (nalUnit) {
      var halfSecond = 45000,
          // Half-a-second in a 90khz clock
      allowableOverlap = 10000,
          // About 3 frames @ 30fps
      nearestDistance = Infinity,
          dtsDistance,
          nearestGopObj,
          currentGop,
          currentGopObj,
          i; // Search for the GOP nearest to the beginning of this nal unit

      for (i = 0; i < this.gopCache_.length; i++) {
        currentGopObj = this.gopCache_[i];
        currentGop = currentGopObj.gop; // Reject Gops with different SPS or PPS

        if (!(track.pps && arrayEquals(track.pps[0], currentGopObj.pps[0])) || !(track.sps && arrayEquals(track.sps[0], currentGopObj.sps[0]))) {
          continue;
        } // Reject Gops that would require a negative baseMediaDecodeTime


        if (currentGop.dts < track.timelineStartInfo.dts) {
          continue;
        } // The distance between the end of the gop and the start of the nalUnit


        dtsDistance = nalUnit.dts - currentGop.dts - currentGop.duration; // Only consider GOPS that start before the nal unit and end within
        // a half-second of the nal unit

        if (dtsDistance >= -allowableOverlap && dtsDistance <= halfSecond) {
          // Always use the closest GOP we found if there is more than
          // one candidate
          if (!nearestGopObj || nearestDistance > dtsDistance) {
            nearestGopObj = currentGopObj;
            nearestDistance = dtsDistance;
          }
        }
      }

      if (nearestGopObj) {
        return nearestGopObj.gop;
      }

      return null;
    }; // trim gop list to the first gop found that has a matching pts with a gop in the list
    // of gopsToAlignWith starting from the START of the list


    this.alignGopsAtStart_ = function (gops) {
      var alignIndex, gopIndex, align, gop, byteLength, nalCount, duration, alignedGops;
      byteLength = gops.byteLength;
      nalCount = gops.nalCount;
      duration = gops.duration;
      alignIndex = gopIndex = 0;

      while (alignIndex < gopsToAlignWith.length && gopIndex < gops.length) {
        align = gopsToAlignWith[alignIndex];
        gop = gops[gopIndex];

        if (align.pts === gop.pts) {
          break;
        }

        if (gop.pts > align.pts) {
          // this current gop starts after the current gop we want to align on, so increment
          // align index
          alignIndex++;
          continue;
        } // current gop starts before the current gop we want to align on. so increment gop
        // index


        gopIndex++;
        byteLength -= gop.byteLength;
        nalCount -= gop.nalCount;
        duration -= gop.duration;
      }

      if (gopIndex === 0) {
        // no gops to trim
        return gops;
      }

      if (gopIndex === gops.length) {
        // all gops trimmed, skip appending all gops
        return null;
      }

      alignedGops = gops.slice(gopIndex);
      alignedGops.byteLength = byteLength;
      alignedGops.duration = duration;
      alignedGops.nalCount = nalCount;
      alignedGops.pts = alignedGops[0].pts;
      alignedGops.dts = alignedGops[0].dts;
      return alignedGops;
    }; // trim gop list to the first gop found that has a matching pts with a gop in the list
    // of gopsToAlignWith starting from the END of the list


    this.alignGopsAtEnd_ = function (gops) {
      var alignIndex, gopIndex, align, gop, alignEndIndex, matchFound;
      alignIndex = gopsToAlignWith.length - 1;
      gopIndex = gops.length - 1;
      alignEndIndex = null;
      matchFound = false;

      while (alignIndex >= 0 && gopIndex >= 0) {
        align = gopsToAlignWith[alignIndex];
        gop = gops[gopIndex];

        if (align.pts === gop.pts) {
          matchFound = true;
          break;
        }

        if (align.pts > gop.pts) {
          alignIndex--;
          continue;
        }

        if (alignIndex === gopsToAlignWith.length - 1) {
          // gop.pts is greater than the last alignment candidate. If no match is found
          // by the end of this loop, we still want to append gops that come after this
          // point
          alignEndIndex = gopIndex;
        }

        gopIndex--;
      }

      if (!matchFound && alignEndIndex === null) {
        return null;
      }

      var trimIndex;

      if (matchFound) {
        trimIndex = gopIndex;
      } else {
        trimIndex = alignEndIndex;
      }

      if (trimIndex === 0) {
        return gops;
      }

      var alignedGops = gops.slice(trimIndex);
      var metadata = alignedGops.reduce(function (total, gop) {
        total.byteLength += gop.byteLength;
        total.duration += gop.duration;
        total.nalCount += gop.nalCount;
        return total;
      }, {
        byteLength: 0,
        duration: 0,
        nalCount: 0
      });
      alignedGops.byteLength = metadata.byteLength;
      alignedGops.duration = metadata.duration;
      alignedGops.nalCount = metadata.nalCount;
      alignedGops.pts = alignedGops[0].pts;
      alignedGops.dts = alignedGops[0].dts;
      return alignedGops;
    };

    this.alignGopsWith = function (newGopsToAlignWith) {
      gopsToAlignWith = newGopsToAlignWith;
    };
  };

  _VideoSegmentStream.prototype = new stream();
  /**
   * A Stream that can combine multiple streams (ie. audio & video)
   * into a single output segment for MSE. Also supports audio-only
   * and video-only streams.
   * @param options {object} transmuxer options object
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at media timeline start.
   */

  _CoalesceStream = function CoalesceStream(options, metadataStream) {
    // Number of Tracks per output segment
    // If greater than 1, we combine multiple
    // tracks into a single segment
    this.numberOfTracks = 0;
    this.metadataStream = metadataStream;
    options = options || {};

    if (typeof options.remux !== 'undefined') {
      this.remuxTracks = !!options.remux;
    } else {
      this.remuxTracks = true;
    }

    if (typeof options.keepOriginalTimestamps === 'boolean') {
      this.keepOriginalTimestamps = options.keepOriginalTimestamps;
    } else {
      this.keepOriginalTimestamps = false;
    }

    this.pendingTracks = [];
    this.videoTrack = null;
    this.pendingBoxes = [];
    this.pendingCaptions = [];
    this.pendingMetadata = [];
    this.pendingBytes = 0;
    this.emittedTracks = 0;

    _CoalesceStream.prototype.init.call(this); // Take output from multiple


    this.push = function (output) {
      // buffer incoming captions until the associated video segment
      // finishes
      if (output.text) {
        return this.pendingCaptions.push(output);
      } // buffer incoming id3 tags until the final flush


      if (output.frames) {
        return this.pendingMetadata.push(output);
      } // Add this track to the list of pending tracks and store
      // important information required for the construction of
      // the final segment


      this.pendingTracks.push(output.track);
      this.pendingBytes += output.boxes.byteLength; // TODO: is there an issue for this against chrome?
      // We unshift audio and push video because
      // as of Chrome 75 when switching from
      // one init segment to another if the video
      // mdat does not appear after the audio mdat
      // only audio will play for the duration of our transmux.

      if (output.track.type === 'video') {
        this.videoTrack = output.track;
        this.pendingBoxes.push(output.boxes);
      }

      if (output.track.type === 'audio') {
        this.audioTrack = output.track;
        this.pendingBoxes.unshift(output.boxes);
      }
    };
  };

  _CoalesceStream.prototype = new stream();

  _CoalesceStream.prototype.flush = function (flushSource) {
    var offset = 0,
        event = {
      captions: [],
      captionStreams: {},
      metadata: [],
      info: {}
    },
        caption,
        id3,
        initSegment,
        timelineStartPts = 0,
        i;

    if (this.pendingTracks.length < this.numberOfTracks) {
      if (flushSource !== 'VideoSegmentStream' && flushSource !== 'AudioSegmentStream') {
        // Return because we haven't received a flush from a data-generating
        // portion of the segment (meaning that we have only recieved meta-data
        // or captions.)
        return;
      } else if (this.remuxTracks) {
        // Return until we have enough tracks from the pipeline to remux (if we
        // are remuxing audio and video into a single MP4)
        return;
      } else if (this.pendingTracks.length === 0) {
        // In the case where we receive a flush without any data having been
        // received we consider it an emitted track for the purposes of coalescing
        // `done` events.
        // We do this for the case where there is an audio and video track in the
        // segment but no audio data. (seen in several playlists with alternate
        // audio tracks and no audio present in the main TS segments.)
        this.emittedTracks++;

        if (this.emittedTracks >= this.numberOfTracks) {
          this.trigger('done');
          this.emittedTracks = 0;
        }

        return;
      }
    }

    if (this.videoTrack) {
      timelineStartPts = this.videoTrack.timelineStartInfo.pts;
      videoProperties.forEach(function (prop) {
        event.info[prop] = this.videoTrack[prop];
      }, this);
    } else if (this.audioTrack) {
      timelineStartPts = this.audioTrack.timelineStartInfo.pts;
      audioProperties.forEach(function (prop) {
        event.info[prop] = this.audioTrack[prop];
      }, this);
    }

    if (this.videoTrack || this.audioTrack) {
      if (this.pendingTracks.length === 1) {
        event.type = this.pendingTracks[0].type;
      } else {
        event.type = 'combined';
      }

      this.emittedTracks += this.pendingTracks.length;
      initSegment = mp4Generator.initSegment(this.pendingTracks); // Create a new typed array to hold the init segment

      event.initSegment = new Uint8Array(initSegment.byteLength); // Create an init segment containing a moov
      // and track definitions

      event.initSegment.set(initSegment); // Create a new typed array to hold the moof+mdats

      event.data = new Uint8Array(this.pendingBytes); // Append each moof+mdat (one per track) together

      for (i = 0; i < this.pendingBoxes.length; i++) {
        event.data.set(this.pendingBoxes[i], offset);
        offset += this.pendingBoxes[i].byteLength;
      } // Translate caption PTS times into second offsets to match the
      // video timeline for the segment, and add track info


      for (i = 0; i < this.pendingCaptions.length; i++) {
        caption = this.pendingCaptions[i];
        caption.startTime = clock.metadataTsToSeconds(caption.startPts, timelineStartPts, this.keepOriginalTimestamps);
        caption.endTime = clock.metadataTsToSeconds(caption.endPts, timelineStartPts, this.keepOriginalTimestamps);
        event.captionStreams[caption.stream] = true;
        event.captions.push(caption);
      } // Translate ID3 frame PTS times into second offsets to match the
      // video timeline for the segment


      for (i = 0; i < this.pendingMetadata.length; i++) {
        id3 = this.pendingMetadata[i];
        id3.cueTime = clock.metadataTsToSeconds(id3.pts, timelineStartPts, this.keepOriginalTimestamps);
        event.metadata.push(id3);
      } // We add this to every single emitted segment even though we only need
      // it for the first


      event.metadata.dispatchType = this.metadataStream.dispatchType; // Reset stream state

      this.pendingTracks.length = 0;
      this.videoTrack = null;
      this.pendingBoxes.length = 0;
      this.pendingCaptions.length = 0;
      this.pendingBytes = 0;
      this.pendingMetadata.length = 0; // Emit the built segment
      // We include captions and ID3 tags for backwards compatibility,
      // ideally we should send only video and audio in the data event

      this.trigger('data', event); // Emit each caption to the outside world
      // Ideally, this would happen immediately on parsing captions,
      // but we need to ensure that video data is sent back first
      // so that caption timing can be adjusted to match video timing

      for (i = 0; i < event.captions.length; i++) {
        caption = event.captions[i];
        this.trigger('caption', caption);
      } // Emit each id3 tag to the outside world
      // Ideally, this would happen immediately on parsing the tag,
      // but we need to ensure that video data is sent back first
      // so that ID3 frame timing can be adjusted to match video timing


      for (i = 0; i < event.metadata.length; i++) {
        id3 = event.metadata[i];
        this.trigger('id3Frame', id3);
      }
    } // Only emit `done` if all tracks have been flushed and emitted


    if (this.emittedTracks >= this.numberOfTracks) {
      this.trigger('done');
      this.emittedTracks = 0;
    }
  };

  _CoalesceStream.prototype.setRemux = function (val) {
    this.remuxTracks = val;
  };
  /**
   * A Stream that expects MP2T binary data as input and produces
   * corresponding media segments, suitable for use with Media Source
   * Extension (MSE) implementations that support the ISO BMFF byte
   * stream format, like Chrome.
   */


  _Transmuxer = function Transmuxer(options) {
    var self = this,
        hasFlushed = true,
        videoTrack,
        audioTrack;

    _Transmuxer.prototype.init.call(this);

    options = options || {};
    this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
    this.transmuxPipeline_ = {};

    this.setupAacPipeline = function () {
      var pipeline = {};
      this.transmuxPipeline_ = pipeline;
      pipeline.type = 'aac';
      pipeline.metadataStream = new m2ts_1.MetadataStream(); // set up the parsing pipeline

      pipeline.aacStream = new aac();
      pipeline.audioTimestampRolloverStream = new m2ts_1.TimestampRolloverStream('audio');
      pipeline.timedMetadataTimestampRolloverStream = new m2ts_1.TimestampRolloverStream('timed-metadata');
      pipeline.adtsStream = new adts();
      pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
      pipeline.headOfPipeline = pipeline.aacStream;
      pipeline.aacStream.pipe(pipeline.audioTimestampRolloverStream).pipe(pipeline.adtsStream);
      pipeline.aacStream.pipe(pipeline.timedMetadataTimestampRolloverStream).pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream);
      pipeline.metadataStream.on('timestamp', function (frame) {
        pipeline.aacStream.setTimestamp(frame.timeStamp);
      });
      pipeline.aacStream.on('data', function (data) {
        if (data.type !== 'timed-metadata' && data.type !== 'audio' || pipeline.audioSegmentStream) {
          return;
        }

        audioTrack = audioTrack || {
          timelineStartInfo: {
            baseMediaDecodeTime: self.baseMediaDecodeTime
          },
          codec: 'adts',
          type: 'audio'
        }; // hook up the audio segment stream to the first track with aac data

        pipeline.coalesceStream.numberOfTracks++;
        pipeline.audioSegmentStream = new _AudioSegmentStream(audioTrack, options);
        pipeline.audioSegmentStream.on('log', self.getLogTrigger_('audioSegmentStream'));
        pipeline.audioSegmentStream.on('timingInfo', self.trigger.bind(self, 'audioTimingInfo')); // Set up the final part of the audio pipeline

        pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream); // emit pmt info

        self.trigger('trackinfo', {
          hasAudio: !!audioTrack,
          hasVideo: !!videoTrack
        });
      }); // Re-emit any data coming from the coalesce stream to the outside world

      pipeline.coalesceStream.on('data', this.trigger.bind(this, 'data')); // Let the consumer know we have finished flushing the entire pipeline

      pipeline.coalesceStream.on('done', this.trigger.bind(this, 'done'));
      addPipelineLogRetriggers(this, pipeline);
    };

    this.setupTsPipeline = function () {
      var pipeline = {};
      this.transmuxPipeline_ = pipeline;
      pipeline.type = 'ts';
      pipeline.metadataStream = new m2ts_1.MetadataStream(); // set up the parsing pipeline

      pipeline.packetStream = new m2ts_1.TransportPacketStream();
      pipeline.parseStream = new m2ts_1.TransportParseStream();
      pipeline.elementaryStream = new m2ts_1.ElementaryStream();
      pipeline.timestampRolloverStream = new m2ts_1.TimestampRolloverStream();
      pipeline.adtsStream = new adts();
      pipeline.h264Stream = new H264Stream();
      pipeline.captionStream = new m2ts_1.CaptionStream(options);
      pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
      pipeline.headOfPipeline = pipeline.packetStream; // disassemble MPEG2-TS packets into elementary streams

      pipeline.packetStream.pipe(pipeline.parseStream).pipe(pipeline.elementaryStream).pipe(pipeline.timestampRolloverStream); // !!THIS ORDER IS IMPORTANT!!
      // demux the streams

      pipeline.timestampRolloverStream.pipe(pipeline.h264Stream);
      pipeline.timestampRolloverStream.pipe(pipeline.adtsStream);
      pipeline.timestampRolloverStream.pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream); // Hook up CEA-608/708 caption stream

      pipeline.h264Stream.pipe(pipeline.captionStream).pipe(pipeline.coalesceStream);
      pipeline.elementaryStream.on('data', function (data) {
        var i;

        if (data.type === 'metadata') {
          i = data.tracks.length; // scan the tracks listed in the metadata

          while (i--) {
            if (!videoTrack && data.tracks[i].type === 'video') {
              videoTrack = data.tracks[i];
              videoTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
            } else if (!audioTrack && data.tracks[i].type === 'audio') {
              audioTrack = data.tracks[i];
              audioTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
            }
          } // hook up the video segment stream to the first track with h264 data


          if (videoTrack && !pipeline.videoSegmentStream) {
            pipeline.coalesceStream.numberOfTracks++;
            pipeline.videoSegmentStream = new _VideoSegmentStream(videoTrack, options);
            pipeline.videoSegmentStream.on('log', self.getLogTrigger_('videoSegmentStream'));
            pipeline.videoSegmentStream.on('timelineStartInfo', function (timelineStartInfo) {
              // When video emits timelineStartInfo data after a flush, we forward that
              // info to the AudioSegmentStream, if it exists, because video timeline
              // data takes precedence.  Do not do this if keepOriginalTimestamps is set,
              // because this is a particularly subtle form of timestamp alteration.
              if (audioTrack && !options.keepOriginalTimestamps) {
                audioTrack.timelineStartInfo = timelineStartInfo; // On the first segment we trim AAC frames that exist before the
                // very earliest DTS we have seen in video because Chrome will
                // interpret any video track with a baseMediaDecodeTime that is
                // non-zero as a gap.

                pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - self.baseMediaDecodeTime);
              }
            });
            pipeline.videoSegmentStream.on('processedGopsInfo', self.trigger.bind(self, 'gopInfo'));
            pipeline.videoSegmentStream.on('segmentTimingInfo', self.trigger.bind(self, 'videoSegmentTimingInfo'));
            pipeline.videoSegmentStream.on('baseMediaDecodeTime', function (baseMediaDecodeTime) {
              if (audioTrack) {
                pipeline.audioSegmentStream.setVideoBaseMediaDecodeTime(baseMediaDecodeTime);
              }
            });
            pipeline.videoSegmentStream.on('timingInfo', self.trigger.bind(self, 'videoTimingInfo')); // Set up the final part of the video pipeline

            pipeline.h264Stream.pipe(pipeline.videoSegmentStream).pipe(pipeline.coalesceStream);
          }

          if (audioTrack && !pipeline.audioSegmentStream) {
            // hook up the audio segment stream to the first track with aac data
            pipeline.coalesceStream.numberOfTracks++;
            pipeline.audioSegmentStream = new _AudioSegmentStream(audioTrack, options);
            pipeline.audioSegmentStream.on('log', self.getLogTrigger_('audioSegmentStream'));
            pipeline.audioSegmentStream.on('timingInfo', self.trigger.bind(self, 'audioTimingInfo'));
            pipeline.audioSegmentStream.on('segmentTimingInfo', self.trigger.bind(self, 'audioSegmentTimingInfo')); // Set up the final part of the audio pipeline

            pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream);
          } // emit pmt info


          self.trigger('trackinfo', {
            hasAudio: !!audioTrack,
            hasVideo: !!videoTrack
          });
        }
      }); // Re-emit any data coming from the coalesce stream to the outside world

      pipeline.coalesceStream.on('data', this.trigger.bind(this, 'data'));
      pipeline.coalesceStream.on('id3Frame', function (id3Frame) {
        id3Frame.dispatchType = pipeline.metadataStream.dispatchType;
        self.trigger('id3Frame', id3Frame);
      });
      pipeline.coalesceStream.on('caption', this.trigger.bind(this, 'caption')); // Let the consumer know we have finished flushing the entire pipeline

      pipeline.coalesceStream.on('done', this.trigger.bind(this, 'done'));
      addPipelineLogRetriggers(this, pipeline);
    }; // hook up the segment streams once track metadata is delivered


    this.setBaseMediaDecodeTime = function (baseMediaDecodeTime) {
      var pipeline = this.transmuxPipeline_;

      if (!options.keepOriginalTimestamps) {
        this.baseMediaDecodeTime = baseMediaDecodeTime;
      }

      if (audioTrack) {
        audioTrack.timelineStartInfo.dts = undefined;
        audioTrack.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(audioTrack);

        if (pipeline.audioTimestampRolloverStream) {
          pipeline.audioTimestampRolloverStream.discontinuity();
        }
      }

      if (videoTrack) {
        if (pipeline.videoSegmentStream) {
          pipeline.videoSegmentStream.gopCache_ = [];
        }

        videoTrack.timelineStartInfo.dts = undefined;
        videoTrack.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(videoTrack);
        pipeline.captionStream.reset();
      }

      if (pipeline.timestampRolloverStream) {
        pipeline.timestampRolloverStream.discontinuity();
      }
    };

    this.setAudioAppendStart = function (timestamp) {
      if (audioTrack) {
        this.transmuxPipeline_.audioSegmentStream.setAudioAppendStart(timestamp);
      }
    };

    this.setRemux = function (val) {
      var pipeline = this.transmuxPipeline_;
      options.remux = val;

      if (pipeline && pipeline.coalesceStream) {
        pipeline.coalesceStream.setRemux(val);
      }
    };

    this.alignGopsWith = function (gopsToAlignWith) {
      if (videoTrack && this.transmuxPipeline_.videoSegmentStream) {
        this.transmuxPipeline_.videoSegmentStream.alignGopsWith(gopsToAlignWith);
      }
    };

    this.getLogTrigger_ = function (key) {
      var self = this;
      return function (event) {
        event.stream = key;
        self.trigger('log', event);
      };
    }; // feed incoming data to the front of the parsing pipeline


    this.push = function (data) {
      if (hasFlushed) {
        var isAac = isLikelyAacData(data);

        if (isAac && this.transmuxPipeline_.type !== 'aac') {
          this.setupAacPipeline();
        } else if (!isAac && this.transmuxPipeline_.type !== 'ts') {
          this.setupTsPipeline();
        }

        hasFlushed = false;
      }

      this.transmuxPipeline_.headOfPipeline.push(data);
    }; // flush any buffered data


    this.flush = function () {
      hasFlushed = true; // Start at the top of the pipeline and flush all pending work

      this.transmuxPipeline_.headOfPipeline.flush();
    };

    this.endTimeline = function () {
      this.transmuxPipeline_.headOfPipeline.endTimeline();
    };

    this.reset = function () {
      if (this.transmuxPipeline_.headOfPipeline) {
        this.transmuxPipeline_.headOfPipeline.reset();
      }
    }; // Caption data has to be reset when seeking outside buffered range


    this.resetCaptions = function () {
      if (this.transmuxPipeline_.captionStream) {
        this.transmuxPipeline_.captionStream.reset();
      }
    };
  };

  _Transmuxer.prototype = new stream();
  var transmuxer = {
    Transmuxer: _Transmuxer,
    VideoSegmentStream: _VideoSegmentStream,
    AudioSegmentStream: _AudioSegmentStream,
    AUDIO_PROPERTIES: audioProperties,
    VIDEO_PROPERTIES: videoProperties,
    // exported for testing
    generateSegmentTimingInfo: generateSegmentTimingInfo
  };
  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var toUnsigned$3 = function toUnsigned(value) {
    return value >>> 0;
  };

  var toHexString$1 = function toHexString(value) {
    return ('00' + value.toString(16)).slice(-2);
  };

  var bin = {
    toUnsigned: toUnsigned$3,
    toHexString: toHexString$1
  };

  var parseType$1 = function parseType(buffer) {
    var result = '';
    result += String.fromCharCode(buffer[0]);
    result += String.fromCharCode(buffer[1]);
    result += String.fromCharCode(buffer[2]);
    result += String.fromCharCode(buffer[3]);
    return result;
  };

  var parseType_1 = parseType$1;
  var toUnsigned$2 = bin.toUnsigned;

  var findBox = function findBox(data, path) {
    var results = [],
        i,
        size,
        type,
        end,
        subresults;

    if (!path.length) {
      // short-circuit the search for empty paths
      return null;
    }

    for (i = 0; i < data.byteLength;) {
      size = toUnsigned$2(data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | data[i + 3]);
      type = parseType_1(data.subarray(i + 4, i + 8));
      end = size > 1 ? i + size : data.byteLength;

      if (type === path[0]) {
        if (path.length === 1) {
          // this is the end of the path and we've found the box we were
          // looking for
          results.push(data.subarray(i + 8, end));
        } else {
          // recursively search for the next box along the path
          subresults = findBox(data.subarray(i + 8, end), path.slice(1));

          if (subresults.length) {
            results = results.concat(subresults);
          }
        }
      }

      i = end;
    } // we've finished searching all of data


    return results;
  };

  var findBox_1 = findBox;
  var toUnsigned$1 = bin.toUnsigned;
  var getUint64$1 = numbers.getUint64;

  var tfdt = function tfdt(data) {
    var result = {
      version: data[0],
      flags: new Uint8Array(data.subarray(1, 4))
    };

    if (result.version === 1) {
      result.baseMediaDecodeTime = getUint64$1(data.subarray(4));
    } else {
      result.baseMediaDecodeTime = toUnsigned$1(data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]);
    }

    return result;
  };

  var parseTfdt = tfdt;

  var parseSampleFlags = function parseSampleFlags(flags) {
    return {
      isLeading: (flags[0] & 0x0c) >>> 2,
      dependsOn: flags[0] & 0x03,
      isDependedOn: (flags[1] & 0xc0) >>> 6,
      hasRedundancy: (flags[1] & 0x30) >>> 4,
      paddingValue: (flags[1] & 0x0e) >>> 1,
      isNonSyncSample: flags[1] & 0x01,
      degradationPriority: flags[2] << 8 | flags[3]
    };
  };

  var parseSampleFlags_1 = parseSampleFlags;

  var trun = function trun(data) {
    var result = {
      version: data[0],
      flags: new Uint8Array(data.subarray(1, 4)),
      samples: []
    },
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        // Flag interpretation
    dataOffsetPresent = result.flags[2] & 0x01,
        // compare with 2nd byte of 0x1
    firstSampleFlagsPresent = result.flags[2] & 0x04,
        // compare with 2nd byte of 0x4
    sampleDurationPresent = result.flags[1] & 0x01,
        // compare with 2nd byte of 0x100
    sampleSizePresent = result.flags[1] & 0x02,
        // compare with 2nd byte of 0x200
    sampleFlagsPresent = result.flags[1] & 0x04,
        // compare with 2nd byte of 0x400
    sampleCompositionTimeOffsetPresent = result.flags[1] & 0x08,
        // compare with 2nd byte of 0x800
    sampleCount = view.getUint32(4),
        offset = 8,
        sample;

    if (dataOffsetPresent) {
      // 32 bit signed integer
      result.dataOffset = view.getInt32(offset);
      offset += 4;
    } // Overrides the flags for the first sample only. The order of
    // optional values will be: duration, size, compositionTimeOffset


    if (firstSampleFlagsPresent && sampleCount) {
      sample = {
        flags: parseSampleFlags_1(data.subarray(offset, offset + 4))
      };
      offset += 4;

      if (sampleDurationPresent) {
        sample.duration = view.getUint32(offset);
        offset += 4;
      }

      if (sampleSizePresent) {
        sample.size = view.getUint32(offset);
        offset += 4;
      }

      if (sampleCompositionTimeOffsetPresent) {
        if (result.version === 1) {
          sample.compositionTimeOffset = view.getInt32(offset);
        } else {
          sample.compositionTimeOffset = view.getUint32(offset);
        }

        offset += 4;
      }

      result.samples.push(sample);
      sampleCount--;
    }

    while (sampleCount--) {
      sample = {};

      if (sampleDurationPresent) {
        sample.duration = view.getUint32(offset);
        offset += 4;
      }

      if (sampleSizePresent) {
        sample.size = view.getUint32(offset);
        offset += 4;
      }

      if (sampleFlagsPresent) {
        sample.flags = parseSampleFlags_1(data.subarray(offset, offset + 4));
        offset += 4;
      }

      if (sampleCompositionTimeOffsetPresent) {
        if (result.version === 1) {
          sample.compositionTimeOffset = view.getInt32(offset);
        } else {
          sample.compositionTimeOffset = view.getUint32(offset);
        }

        offset += 4;
      }

      result.samples.push(sample);
    }

    return result;
  };

  var parseTrun = trun;

  var tfhd = function tfhd(data) {
    var view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        result = {
      version: data[0],
      flags: new Uint8Array(data.subarray(1, 4)),
      trackId: view.getUint32(4)
    },
        baseDataOffsetPresent = result.flags[2] & 0x01,
        sampleDescriptionIndexPresent = result.flags[2] & 0x02,
        defaultSampleDurationPresent = result.flags[2] & 0x08,
        defaultSampleSizePresent = result.flags[2] & 0x10,
        defaultSampleFlagsPresent = result.flags[2] & 0x20,
        durationIsEmpty = result.flags[0] & 0x010000,
        defaultBaseIsMoof = result.flags[0] & 0x020000,
        i;
    i = 8;

    if (baseDataOffsetPresent) {
      i += 4; // truncate top 4 bytes
      // FIXME: should we read the full 64 bits?

      result.baseDataOffset = view.getUint32(12);
      i += 4;
    }

    if (sampleDescriptionIndexPresent) {
      result.sampleDescriptionIndex = view.getUint32(i);
      i += 4;
    }

    if (defaultSampleDurationPresent) {
      result.defaultSampleDuration = view.getUint32(i);
      i += 4;
    }

    if (defaultSampleSizePresent) {
      result.defaultSampleSize = view.getUint32(i);
      i += 4;
    }

    if (defaultSampleFlagsPresent) {
      result.defaultSampleFlags = view.getUint32(i);
    }

    if (durationIsEmpty) {
      result.durationIsEmpty = true;
    }

    if (!baseDataOffsetPresent && defaultBaseIsMoof) {
      result.baseDataOffsetIsMoof = true;
    }

    return result;
  };

  var parseTfhd = tfhd;
  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
  var win;

  if (typeof window !== "undefined") {
    win = window;
  } else if (typeof commonjsGlobal !== "undefined") {
    win = commonjsGlobal;
  } else if (typeof self !== "undefined") {
    win = self;
  } else {
    win = {};
  }

  var window_1 = win;
  var discardEmulationPreventionBytes = captionPacketParser.discardEmulationPreventionBytes;
  var CaptionStream = captionStream.CaptionStream;
  /**
    * Maps an offset in the mdat to a sample based on the the size of the samples.
    * Assumes that `parseSamples` has been called first.
    *
    * @param {Number} offset - The offset into the mdat
    * @param {Object[]} samples - An array of samples, parsed using `parseSamples`
    * @return {?Object} The matching sample, or null if no match was found.
    *
    * @see ISO-BMFF-12/2015, Section 8.8.8
   **/

  var mapToSample = function mapToSample(offset, samples) {
    var approximateOffset = offset;

    for (var i = 0; i < samples.length; i++) {
      var sample = samples[i];

      if (approximateOffset < sample.size) {
        return sample;
      }

      approximateOffset -= sample.size;
    }

    return null;
  };
  /**
    * Finds SEI nal units contained in a Media Data Box.
    * Assumes that `parseSamples` has been called first.
    *
    * @param {Uint8Array} avcStream - The bytes of the mdat
    * @param {Object[]} samples - The samples parsed out by `parseSamples`
    * @param {Number} trackId - The trackId of this video track
    * @return {Object[]} seiNals - the parsed SEI NALUs found.
    *   The contents of the seiNal should match what is expected by
    *   CaptionStream.push (nalUnitType, size, data, escapedRBSP, pts, dts)
    *
    * @see ISO-BMFF-12/2015, Section 8.1.1
    * @see Rec. ITU-T H.264, 7.3.2.3.1
   **/


  var findSeiNals = function findSeiNals(avcStream, samples, trackId) {
    var avcView = new DataView(avcStream.buffer, avcStream.byteOffset, avcStream.byteLength),
        result = {
      logs: [],
      seiNals: []
    },
        seiNal,
        i,
        length,
        lastMatchedSample;

    for (i = 0; i + 4 < avcStream.length; i += length) {
      length = avcView.getUint32(i);
      i += 4; // Bail if this doesn't appear to be an H264 stream

      if (length <= 0) {
        continue;
      }

      switch (avcStream[i] & 0x1F) {
        case 0x06:
          var data = avcStream.subarray(i + 1, i + 1 + length);
          var matchingSample = mapToSample(i, samples);
          seiNal = {
            nalUnitType: 'sei_rbsp',
            size: length,
            data: data,
            escapedRBSP: discardEmulationPreventionBytes(data),
            trackId: trackId
          };

          if (matchingSample) {
            seiNal.pts = matchingSample.pts;
            seiNal.dts = matchingSample.dts;
            lastMatchedSample = matchingSample;
          } else if (lastMatchedSample) {
            // If a matching sample cannot be found, use the last
            // sample's values as they should be as close as possible
            seiNal.pts = lastMatchedSample.pts;
            seiNal.dts = lastMatchedSample.dts;
          } else {
            result.logs.push({
              level: 'warn',
              message: 'We\'ve encountered a nal unit without data at ' + i + ' for trackId ' + trackId + '. See mux.js#223.'
            });
            break;
          }

          result.seiNals.push(seiNal);
          break;
      }
    }

    return result;
  };
  /**
    * Parses sample information out of Track Run Boxes and calculates
    * the absolute presentation and decode timestamps of each sample.
    *
    * @param {Array<Uint8Array>} truns - The Trun Run boxes to be parsed
    * @param {Number|BigInt} baseMediaDecodeTime - base media decode time from tfdt
        @see ISO-BMFF-12/2015, Section 8.8.12
    * @param {Object} tfhd - The parsed Track Fragment Header
    *   @see inspect.parseTfhd
    * @return {Object[]} the parsed samples
    *
    * @see ISO-BMFF-12/2015, Section 8.8.8
   **/


  var parseSamples = function parseSamples(truns, baseMediaDecodeTime, tfhd) {
    var currentDts = baseMediaDecodeTime;
    var defaultSampleDuration = tfhd.defaultSampleDuration || 0;
    var defaultSampleSize = tfhd.defaultSampleSize || 0;
    var trackId = tfhd.trackId;
    var allSamples = [];
    truns.forEach(function (trun) {
      // Note: We currently do not parse the sample table as well
      // as the trun. It's possible some sources will require this.
      // moov > trak > mdia > minf > stbl
      var trackRun = parseTrun(trun);
      var samples = trackRun.samples;
      samples.forEach(function (sample) {
        if (sample.duration === undefined) {
          sample.duration = defaultSampleDuration;
        }

        if (sample.size === undefined) {
          sample.size = defaultSampleSize;
        }

        sample.trackId = trackId;
        sample.dts = currentDts;

        if (sample.compositionTimeOffset === undefined) {
          sample.compositionTimeOffset = 0;
        }

        if (typeof currentDts === 'bigint') {
          sample.pts = currentDts + window_1.BigInt(sample.compositionTimeOffset);
          currentDts += window_1.BigInt(sample.duration);
        } else {
          sample.pts = currentDts + sample.compositionTimeOffset;
          currentDts += sample.duration;
        }
      });
      allSamples = allSamples.concat(samples);
    });
    return allSamples;
  };
  /**
    * Parses out caption nals from an FMP4 segment's video tracks.
    *
    * @param {Uint8Array} segment - The bytes of a single segment
    * @param {Number} videoTrackId - The trackId of a video track in the segment
    * @return {Object.<Number, Object[]>} A mapping of video trackId to
    *   a list of seiNals found in that track
   **/


  var parseCaptionNals = function parseCaptionNals(segment, videoTrackId) {
    // To get the samples
    var trafs = findBox_1(segment, ['moof', 'traf']); // To get SEI NAL units

    var mdats = findBox_1(segment, ['mdat']);
    var captionNals = {};
    var mdatTrafPairs = []; // Pair up each traf with a mdat as moofs and mdats are in pairs

    mdats.forEach(function (mdat, index) {
      var matchingTraf = trafs[index];
      mdatTrafPairs.push({
        mdat: mdat,
        traf: matchingTraf
      });
    });
    mdatTrafPairs.forEach(function (pair) {
      var mdat = pair.mdat;
      var traf = pair.traf;
      var tfhd = findBox_1(traf, ['tfhd']); // Exactly 1 tfhd per traf

      var headerInfo = parseTfhd(tfhd[0]);
      var trackId = headerInfo.trackId;
      var tfdt = findBox_1(traf, ['tfdt']); // Either 0 or 1 tfdt per traf

      var baseMediaDecodeTime = tfdt.length > 0 ? parseTfdt(tfdt[0]).baseMediaDecodeTime : 0;
      var truns = findBox_1(traf, ['trun']);
      var samples;
      var result; // Only parse video data for the chosen video track

      if (videoTrackId === trackId && truns.length > 0) {
        samples = parseSamples(truns, baseMediaDecodeTime, headerInfo);
        result = findSeiNals(mdat, samples, trackId);

        if (!captionNals[trackId]) {
          captionNals[trackId] = {
            seiNals: [],
            logs: []
          };
        }

        captionNals[trackId].seiNals = captionNals[trackId].seiNals.concat(result.seiNals);
        captionNals[trackId].logs = captionNals[trackId].logs.concat(result.logs);
      }
    });
    return captionNals;
  };
  /**
    * Parses out inband captions from an MP4 container and returns
    * caption objects that can be used by WebVTT and the TextTrack API.
    * @see https://developer.mozilla.org/en-US/docs/Web/API/VTTCue
    * @see https://developer.mozilla.org/en-US/docs/Web/API/TextTrack
    * Assumes that `probe.getVideoTrackIds` and `probe.timescale` have been called first
    *
    * @param {Uint8Array} segment - The fmp4 segment containing embedded captions
    * @param {Number} trackId - The id of the video track to parse
    * @param {Number} timescale - The timescale for the video track from the init segment
    *
    * @return {?Object[]} parsedCaptions - A list of captions or null if no video tracks
    * @return {Number} parsedCaptions[].startTime - The time to show the caption in seconds
    * @return {Number} parsedCaptions[].endTime - The time to stop showing the caption in seconds
    * @return {String} parsedCaptions[].text - The visible content of the caption
   **/


  var parseEmbeddedCaptions = function parseEmbeddedCaptions(segment, trackId, timescale) {
    var captionNals; // the ISO-BMFF spec says that trackId can't be zero, but there's some broken content out there

    if (trackId === null) {
      return null;
    }

    captionNals = parseCaptionNals(segment, trackId);
    var trackNals = captionNals[trackId] || {};
    return {
      seiNals: trackNals.seiNals,
      logs: trackNals.logs,
      timescale: timescale
    };
  };
  /**
    * Converts SEI NALUs into captions that can be used by video.js
   **/


  var CaptionParser = function CaptionParser() {
    var isInitialized = false;
    var captionStream; // Stores segments seen before trackId and timescale are set

    var segmentCache; // Stores video track ID of the track being parsed

    var trackId; // Stores the timescale of the track being parsed

    var timescale; // Stores captions parsed so far

    var parsedCaptions; // Stores whether we are receiving partial data or not

    var parsingPartial;
    /**
      * A method to indicate whether a CaptionParser has been initalized
      * @returns {Boolean}
     **/

    this.isInitialized = function () {
      return isInitialized;
    };
    /**
      * Initializes the underlying CaptionStream, SEI NAL parsing
      * and management, and caption collection
     **/


    this.init = function (options) {
      captionStream = new CaptionStream();
      isInitialized = true;
      parsingPartial = options ? options.isPartial : false; // Collect dispatched captions

      captionStream.on('data', function (event) {
        // Convert to seconds in the source's timescale
        event.startTime = event.startPts / timescale;
        event.endTime = event.endPts / timescale;
        parsedCaptions.captions.push(event);
        parsedCaptions.captionStreams[event.stream] = true;
      });
      captionStream.on('log', function (log) {
        parsedCaptions.logs.push(log);
      });
    };
    /**
      * Determines if a new video track will be selected
      * or if the timescale changed
      * @return {Boolean}
     **/


    this.isNewInit = function (videoTrackIds, timescales) {
      if (videoTrackIds && videoTrackIds.length === 0 || timescales && typeof timescales === 'object' && Object.keys(timescales).length === 0) {
        return false;
      }

      return trackId !== videoTrackIds[0] || timescale !== timescales[trackId];
    };
    /**
      * Parses out SEI captions and interacts with underlying
      * CaptionStream to return dispatched captions
      *
      * @param {Uint8Array} segment - The fmp4 segment containing embedded captions
      * @param {Number[]} videoTrackIds - A list of video tracks found in the init segment
      * @param {Object.<Number, Number>} timescales - The timescales found in the init segment
      * @see parseEmbeddedCaptions
      * @see m2ts/caption-stream.js
     **/


    this.parse = function (segment, videoTrackIds, timescales) {
      var parsedData;

      if (!this.isInitialized()) {
        return null; // This is not likely to be a video segment
      } else if (!videoTrackIds || !timescales) {
        return null;
      } else if (this.isNewInit(videoTrackIds, timescales)) {
        // Use the first video track only as there is no
        // mechanism to switch to other video tracks
        trackId = videoTrackIds[0];
        timescale = timescales[trackId]; // If an init segment has not been seen yet, hold onto segment
        // data until we have one.
        // the ISO-BMFF spec says that trackId can't be zero, but there's some broken content out there
      } else if (trackId === null || !timescale) {
        segmentCache.push(segment);
        return null;
      } // Now that a timescale and trackId is set, parse cached segments


      while (segmentCache.length > 0) {
        var cachedSegment = segmentCache.shift();
        this.parse(cachedSegment, videoTrackIds, timescales);
      }

      parsedData = parseEmbeddedCaptions(segment, trackId, timescale);

      if (parsedData && parsedData.logs) {
        parsedCaptions.logs = parsedCaptions.logs.concat(parsedData.logs);
      }

      if (parsedData === null || !parsedData.seiNals) {
        if (parsedCaptions.logs.length) {
          return {
            logs: parsedCaptions.logs,
            captions: [],
            captionStreams: []
          };
        }

        return null;
      }

      this.pushNals(parsedData.seiNals); // Force the parsed captions to be dispatched

      this.flushStream();
      return parsedCaptions;
    };
    /**
      * Pushes SEI NALUs onto CaptionStream
      * @param {Object[]} nals - A list of SEI nals parsed using `parseCaptionNals`
      * Assumes that `parseCaptionNals` has been called first
      * @see m2ts/caption-stream.js
      **/


    this.pushNals = function (nals) {
      if (!this.isInitialized() || !nals || nals.length === 0) {
        return null;
      }

      nals.forEach(function (nal) {
        captionStream.push(nal);
      });
    };
    /**
      * Flushes underlying CaptionStream to dispatch processed, displayable captions
      * @see m2ts/caption-stream.js
     **/


    this.flushStream = function () {
      if (!this.isInitialized()) {
        return null;
      }

      if (!parsingPartial) {
        captionStream.flush();
      } else {
        captionStream.partialFlush();
      }
    };
    /**
      * Reset caption buckets for new data
     **/


    this.clearParsedCaptions = function () {
      parsedCaptions.captions = [];
      parsedCaptions.captionStreams = {};
      parsedCaptions.logs = [];
    };
    /**
      * Resets underlying CaptionStream
      * @see m2ts/caption-stream.js
     **/


    this.resetCaptionStream = function () {
      if (!this.isInitialized()) {
        return null;
      }

      captionStream.reset();
    };
    /**
      * Convenience method to clear all captions flushed from the
      * CaptionStream and still being parsed
      * @see m2ts/caption-stream.js
     **/


    this.clearAllCaptions = function () {
      this.clearParsedCaptions();
      this.resetCaptionStream();
    };
    /**
      * Reset caption parser
     **/


    this.reset = function () {
      segmentCache = [];
      trackId = null;
      timescale = null;

      if (!parsedCaptions) {
        parsedCaptions = {
          captions: [],
          // CC1, CC2, CC3, CC4
          captionStreams: {},
          logs: []
        };
      } else {
        this.clearParsedCaptions();
      }

      this.resetCaptionStream();
    };

    this.reset();
  };

  var captionParser = CaptionParser;
  var toUnsigned = bin.toUnsigned;
  var toHexString = bin.toHexString;
  var getUint64 = numbers.getUint64;
  var timescale, startTime, compositionStartTime, getVideoTrackIds, getTracks, getTimescaleFromMediaHeader;
  /**
   * Parses an MP4 initialization segment and extracts the timescale
   * values for any declared tracks. Timescale values indicate the
   * number of clock ticks per second to assume for time-based values
   * elsewhere in the MP4.
   *
   * To determine the start time of an MP4, you need two pieces of
   * information: the timescale unit and the earliest base media decode
   * time. Multiple timescales can be specified within an MP4 but the
   * base media decode time is always expressed in the timescale from
   * the media header box for the track:
   * ```
   * moov > trak > mdia > mdhd.timescale
   * ```
   * @param init {Uint8Array} the bytes of the init segment
   * @return {object} a hash of track ids to timescale values or null if
   * the init segment is malformed.
   */

  timescale = function timescale(init) {
    var result = {},
        traks = findBox_1(init, ['moov', 'trak']); // mdhd timescale

    return traks.reduce(function (result, trak) {
      var tkhd, version, index, id, mdhd;
      tkhd = findBox_1(trak, ['tkhd'])[0];

      if (!tkhd) {
        return null;
      }

      version = tkhd[0];
      index = version === 0 ? 12 : 20;
      id = toUnsigned(tkhd[index] << 24 | tkhd[index + 1] << 16 | tkhd[index + 2] << 8 | tkhd[index + 3]);
      mdhd = findBox_1(trak, ['mdia', 'mdhd'])[0];

      if (!mdhd) {
        return null;
      }

      version = mdhd[0];
      index = version === 0 ? 12 : 20;
      result[id] = toUnsigned(mdhd[index] << 24 | mdhd[index + 1] << 16 | mdhd[index + 2] << 8 | mdhd[index + 3]);
      return result;
    }, result);
  };
  /**
   * Determine the base media decode start time, in seconds, for an MP4
   * fragment. If multiple fragments are specified, the earliest time is
   * returned.
   *
   * The base media decode time can be parsed from track fragment
   * metadata:
   * ```
   * moof > traf > tfdt.baseMediaDecodeTime
   * ```
   * It requires the timescale value from the mdhd to interpret.
   *
   * @param timescale {object} a hash of track ids to timescale values.
   * @return {number} the earliest base media decode start time for the
   * fragment, in seconds
   */


  startTime = function startTime(timescale, fragment) {
    var trafs; // we need info from two childrend of each track fragment box

    trafs = findBox_1(fragment, ['moof', 'traf']); // determine the start times for each track

    var lowestTime = trafs.reduce(function (acc, traf) {
      var tfhd = findBox_1(traf, ['tfhd'])[0]; // get the track id from the tfhd

      var id = toUnsigned(tfhd[4] << 24 | tfhd[5] << 16 | tfhd[6] << 8 | tfhd[7]); // assume a 90kHz clock if no timescale was specified

      var scale = timescale[id] || 90e3; // get the base media decode time from the tfdt

      var tfdt = findBox_1(traf, ['tfdt'])[0];
      var dv = new DataView(tfdt.buffer, tfdt.byteOffset, tfdt.byteLength);
      var baseTime; // version 1 is 64 bit

      if (tfdt[0] === 1) {
        baseTime = getUint64(tfdt.subarray(4, 12));
      } else {
        baseTime = dv.getUint32(4);
      } // convert base time to seconds if it is a valid number.


      var seconds;

      if (typeof baseTime === 'bigint') {
        seconds = baseTime / window_1.BigInt(scale);
      } else if (typeof baseTime === 'number' && !isNaN(baseTime)) {
        seconds = baseTime / scale;
      }

      if (seconds < Number.MAX_SAFE_INTEGER) {
        seconds = Number(seconds);
      }

      if (seconds < acc) {
        acc = seconds;
      }

      return acc;
    }, Infinity);
    return typeof lowestTime === 'bigint' || isFinite(lowestTime) ? lowestTime : 0;
  };
  /**
   * Determine the composition start, in seconds, for an MP4
   * fragment.
   *
   * The composition start time of a fragment can be calculated using the base
   * media decode time, composition time offset, and timescale, as follows:
   *
   * compositionStartTime = (baseMediaDecodeTime + compositionTimeOffset) / timescale
   *
   * All of the aforementioned information is contained within a media fragment's
   * `traf` box, except for timescale info, which comes from the initialization
   * segment, so a track id (also contained within a `traf`) is also necessary to
   * associate it with a timescale
   *
   *
   * @param timescales {object} - a hash of track ids to timescale values.
   * @param fragment {Unit8Array} - the bytes of a media segment
   * @return {number} the composition start time for the fragment, in seconds
   **/


  compositionStartTime = function compositionStartTime(timescales, fragment) {
    var trafBoxes = findBox_1(fragment, ['moof', 'traf']);
    var baseMediaDecodeTime = 0;
    var compositionTimeOffset = 0;
    var trackId;

    if (trafBoxes && trafBoxes.length) {
      // The spec states that track run samples contained within a `traf` box are contiguous, but
      // it does not explicitly state whether the `traf` boxes themselves are contiguous.
      // We will assume that they are, so we only need the first to calculate start time.
      var tfhd = findBox_1(trafBoxes[0], ['tfhd'])[0];
      var trun = findBox_1(trafBoxes[0], ['trun'])[0];
      var tfdt = findBox_1(trafBoxes[0], ['tfdt'])[0];

      if (tfhd) {
        var parsedTfhd = parseTfhd(tfhd);
        trackId = parsedTfhd.trackId;
      }

      if (tfdt) {
        var parsedTfdt = parseTfdt(tfdt);
        baseMediaDecodeTime = parsedTfdt.baseMediaDecodeTime;
      }

      if (trun) {
        var parsedTrun = parseTrun(trun);

        if (parsedTrun.samples && parsedTrun.samples.length) {
          compositionTimeOffset = parsedTrun.samples[0].compositionTimeOffset || 0;
        }
      }
    } // Get timescale for this specific track. Assume a 90kHz clock if no timescale was
    // specified.


    var timescale = timescales[trackId] || 90e3; // return the composition start time, in seconds

    if (typeof baseMediaDecodeTime === 'bigint') {
      compositionTimeOffset = window_1.BigInt(compositionTimeOffset);
      timescale = window_1.BigInt(timescale);
    }

    var result = (baseMediaDecodeTime + compositionTimeOffset) / timescale;

    if (typeof result === 'bigint' && result < Number.MAX_SAFE_INTEGER) {
      result = Number(result);
    }

    return result;
  };
  /**
    * Find the trackIds of the video tracks in this source.
    * Found by parsing the Handler Reference and Track Header Boxes:
    *   moov > trak > mdia > hdlr
    *   moov > trak > tkhd
    *
    * @param {Uint8Array} init - The bytes of the init segment for this source
    * @return {Number[]} A list of trackIds
    *
    * @see ISO-BMFF-12/2015, Section 8.4.3
   **/


  getVideoTrackIds = function getVideoTrackIds(init) {
    var traks = findBox_1(init, ['moov', 'trak']);
    var videoTrackIds = [];
    traks.forEach(function (trak) {
      var hdlrs = findBox_1(trak, ['mdia', 'hdlr']);
      var tkhds = findBox_1(trak, ['tkhd']);
      hdlrs.forEach(function (hdlr, index) {
        var handlerType = parseType_1(hdlr.subarray(8, 12));
        var tkhd = tkhds[index];
        var view;
        var version;
        var trackId;

        if (handlerType === 'vide') {
          view = new DataView(tkhd.buffer, tkhd.byteOffset, tkhd.byteLength);
          version = view.getUint8(0);
          trackId = version === 0 ? view.getUint32(12) : view.getUint32(20);
          videoTrackIds.push(trackId);
        }
      });
    });
    return videoTrackIds;
  };

  getTimescaleFromMediaHeader = function getTimescaleFromMediaHeader(mdhd) {
    // mdhd is a FullBox, meaning it will have its own version as the first byte
    var version = mdhd[0];
    var index = version === 0 ? 12 : 20;
    return toUnsigned(mdhd[index] << 24 | mdhd[index + 1] << 16 | mdhd[index + 2] << 8 | mdhd[index + 3]);
  };
  /**
   * Get all the video, audio, and hint tracks from a non fragmented
   * mp4 segment
   */


  getTracks = function getTracks(init) {
    var traks = findBox_1(init, ['moov', 'trak']);
    var tracks = [];
    traks.forEach(function (trak) {
      var track = {};
      var tkhd = findBox_1(trak, ['tkhd'])[0];
      var view, tkhdVersion; // id

      if (tkhd) {
        view = new DataView(tkhd.buffer, tkhd.byteOffset, tkhd.byteLength);
        tkhdVersion = view.getUint8(0);
        track.id = tkhdVersion === 0 ? view.getUint32(12) : view.getUint32(20);
      }

      var hdlr = findBox_1(trak, ['mdia', 'hdlr'])[0]; // type

      if (hdlr) {
        var type = parseType_1(hdlr.subarray(8, 12));

        if (type === 'vide') {
          track.type = 'video';
        } else if (type === 'soun') {
          track.type = 'audio';
        } else {
          track.type = type;
        }
      } // codec


      var stsd = findBox_1(trak, ['mdia', 'minf', 'stbl', 'stsd'])[0];

      if (stsd) {
        var sampleDescriptions = stsd.subarray(8); // gives the codec type string

        track.codec = parseType_1(sampleDescriptions.subarray(4, 8));
        var codecBox = findBox_1(sampleDescriptions, [track.codec])[0];
        var codecConfig, codecConfigType;

        if (codecBox) {
          // https://tools.ietf.org/html/rfc6381#section-3.3
          if (/^[asm]vc[1-9]$/i.test(track.codec)) {
            // we don't need anything but the "config" parameter of the
            // avc1 codecBox
            codecConfig = codecBox.subarray(78);
            codecConfigType = parseType_1(codecConfig.subarray(4, 8));

            if (codecConfigType === 'avcC' && codecConfig.length > 11) {
              track.codec += '.'; // left padded with zeroes for single digit hex
              // profile idc

              track.codec += toHexString(codecConfig[9]); // the byte containing the constraint_set flags

              track.codec += toHexString(codecConfig[10]); // level idc

              track.codec += toHexString(codecConfig[11]);
            } else {
              // TODO: show a warning that we couldn't parse the codec
              // and are using the default
              track.codec = 'avc1.4d400d';
            }
          } else if (/^mp4[a,v]$/i.test(track.codec)) {
            // we do not need anything but the streamDescriptor of the mp4a codecBox
            codecConfig = codecBox.subarray(28);
            codecConfigType = parseType_1(codecConfig.subarray(4, 8));

            if (codecConfigType === 'esds' && codecConfig.length > 20 && codecConfig[19] !== 0) {
              track.codec += '.' + toHexString(codecConfig[19]); // this value is only a single digit

              track.codec += '.' + toHexString(codecConfig[20] >>> 2 & 0x3f).replace(/^0/, '');
            } else {
              // TODO: show a warning that we couldn't parse the codec
              // and are using the default
              track.codec = 'mp4a.40.2';
            }
          } else {
            // flac, opus, etc
            track.codec = track.codec.toLowerCase();
          }
        }
      }

      var mdhd = findBox_1(trak, ['mdia', 'mdhd'])[0];

      if (mdhd) {
        track.timescale = getTimescaleFromMediaHeader(mdhd);
      }

      tracks.push(track);
    });
    return tracks;
  };

  var probe$2 = {
    // export mp4 inspector's findBox and parseType for backwards compatibility
    findBox: findBox_1,
    parseType: parseType_1,
    timescale: timescale,
    startTime: startTime,
    compositionStartTime: compositionStartTime,
    videoTrackIds: getVideoTrackIds,
    tracks: getTracks,
    getTimescaleFromMediaHeader: getTimescaleFromMediaHeader
  };

  var parsePid = function parsePid(packet) {
    var pid = packet[1] & 0x1f;
    pid <<= 8;
    pid |= packet[2];
    return pid;
  };

  var parsePayloadUnitStartIndicator = function parsePayloadUnitStartIndicator(packet) {
    return !!(packet[1] & 0x40);
  };

  var parseAdaptionField = function parseAdaptionField(packet) {
    var offset = 0; // if an adaption field is present, its length is specified by the
    // fifth byte of the TS packet header. The adaptation field is
    // used to add stuffing to PES packets that don't fill a complete
    // TS packet, and to specify some forms of timing and control data
    // that we do not currently use.

    if ((packet[3] & 0x30) >>> 4 > 0x01) {
      offset += packet[4] + 1;
    }

    return offset;
  };

  var parseType = function parseType(packet, pmtPid) {
    var pid = parsePid(packet);

    if (pid === 0) {
      return 'pat';
    } else if (pid === pmtPid) {
      return 'pmt';
    } else if (pmtPid) {
      return 'pes';
    }

    return null;
  };

  var parsePat = function parsePat(packet) {
    var pusi = parsePayloadUnitStartIndicator(packet);
    var offset = 4 + parseAdaptionField(packet);

    if (pusi) {
      offset += packet[offset] + 1;
    }

    return (packet[offset + 10] & 0x1f) << 8 | packet[offset + 11];
  };

  var parsePmt = function parsePmt(packet) {
    var programMapTable = {};
    var pusi = parsePayloadUnitStartIndicator(packet);
    var payloadOffset = 4 + parseAdaptionField(packet);

    if (pusi) {
      payloadOffset += packet[payloadOffset] + 1;
    } // PMTs can be sent ahead of the time when they should actually
    // take effect. We don't believe this should ever be the case
    // for HLS but we'll ignore "forward" PMT declarations if we see
    // them. Future PMT declarations have the current_next_indicator
    // set to zero.


    if (!(packet[payloadOffset + 5] & 0x01)) {
      return;
    }

    var sectionLength, tableEnd, programInfoLength; // the mapping table ends at the end of the current section

    sectionLength = (packet[payloadOffset + 1] & 0x0f) << 8 | packet[payloadOffset + 2];
    tableEnd = 3 + sectionLength - 4; // to determine where the table is, we have to figure out how
    // long the program info descriptors are

    programInfoLength = (packet[payloadOffset + 10] & 0x0f) << 8 | packet[payloadOffset + 11]; // advance the offset to the first entry in the mapping table

    var offset = 12 + programInfoLength;

    while (offset < tableEnd) {
      var i = payloadOffset + offset; // add an entry that maps the elementary_pid to the stream_type

      programMapTable[(packet[i + 1] & 0x1F) << 8 | packet[i + 2]] = packet[i]; // move to the next table entry
      // skip past the elementary stream descriptors, if present

      offset += ((packet[i + 3] & 0x0F) << 8 | packet[i + 4]) + 5;
    }

    return programMapTable;
  };

  var parsePesType = function parsePesType(packet, programMapTable) {
    var pid = parsePid(packet);
    var type = programMapTable[pid];

    switch (type) {
      case streamTypes.H264_STREAM_TYPE:
        return 'video';

      case streamTypes.ADTS_STREAM_TYPE:
        return 'audio';

      case streamTypes.METADATA_STREAM_TYPE:
        return 'timed-metadata';

      default:
        return null;
    }
  };

  var parsePesTime = function parsePesTime(packet) {
    var pusi = parsePayloadUnitStartIndicator(packet);

    if (!pusi) {
      return null;
    }

    var offset = 4 + parseAdaptionField(packet);

    if (offset >= packet.byteLength) {
      // From the H 222.0 MPEG-TS spec
      // "For transport stream packets carrying PES packets, stuffing is needed when there
      //  is insufficient PES packet data to completely fill the transport stream packet
      //  payload bytes. Stuffing is accomplished by defining an adaptation field longer than
      //  the sum of the lengths of the data elements in it, so that the payload bytes
      //  remaining after the adaptation field exactly accommodates the available PES packet
      //  data."
      //
      // If the offset is >= the length of the packet, then the packet contains no data
      // and instead is just adaption field stuffing bytes
      return null;
    }

    var pes = null;
    var ptsDtsFlags; // PES packets may be annotated with a PTS value, or a PTS value
    // and a DTS value. Determine what combination of values is
    // available to work with.

    ptsDtsFlags = packet[offset + 7]; // PTS and DTS are normally stored as a 33-bit number.  Javascript
    // performs all bitwise operations on 32-bit integers but javascript
    // supports a much greater range (52-bits) of integer using standard
    // mathematical operations.
    // We construct a 31-bit value using bitwise operators over the 31
    // most significant bits and then multiply by 4 (equal to a left-shift
    // of 2) before we add the final 2 least significant bits of the
    // timestamp (equal to an OR.)

    if (ptsDtsFlags & 0xC0) {
      pes = {}; // the PTS and DTS are not written out directly. For information
      // on how they are encoded, see
      // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html

      pes.pts = (packet[offset + 9] & 0x0E) << 27 | (packet[offset + 10] & 0xFF) << 20 | (packet[offset + 11] & 0xFE) << 12 | (packet[offset + 12] & 0xFF) << 5 | (packet[offset + 13] & 0xFE) >>> 3;
      pes.pts *= 4; // Left shift by 2

      pes.pts += (packet[offset + 13] & 0x06) >>> 1; // OR by the two LSBs

      pes.dts = pes.pts;

      if (ptsDtsFlags & 0x40) {
        pes.dts = (packet[offset + 14] & 0x0E) << 27 | (packet[offset + 15] & 0xFF) << 20 | (packet[offset + 16] & 0xFE) << 12 | (packet[offset + 17] & 0xFF) << 5 | (packet[offset + 18] & 0xFE) >>> 3;
        pes.dts *= 4; // Left shift by 2

        pes.dts += (packet[offset + 18] & 0x06) >>> 1; // OR by the two LSBs
      }
    }

    return pes;
  };

  var parseNalUnitType = function parseNalUnitType(type) {
    switch (type) {
      case 0x05:
        return 'slice_layer_without_partitioning_rbsp_idr';

      case 0x06:
        return 'sei_rbsp';

      case 0x07:
        return 'seq_parameter_set_rbsp';

      case 0x08:
        return 'pic_parameter_set_rbsp';

      case 0x09:
        return 'access_unit_delimiter_rbsp';

      default:
        return null;
    }
  };

  var videoPacketContainsKeyFrame = function videoPacketContainsKeyFrame(packet) {
    var offset = 4 + parseAdaptionField(packet);
    var frameBuffer = packet.subarray(offset);
    var frameI = 0;
    var frameSyncPoint = 0;
    var foundKeyFrame = false;
    var nalType; // advance the sync point to a NAL start, if necessary

    for (; frameSyncPoint < frameBuffer.byteLength - 3; frameSyncPoint++) {
      if (frameBuffer[frameSyncPoint + 2] === 1) {
        // the sync point is properly aligned
        frameI = frameSyncPoint + 5;
        break;
      }
    }

    while (frameI < frameBuffer.byteLength) {
      // look at the current byte to determine if we've hit the end of
      // a NAL unit boundary
      switch (frameBuffer[frameI]) {
        case 0:
          // skip past non-sync sequences
          if (frameBuffer[frameI - 1] !== 0) {
            frameI += 2;
            break;
          } else if (frameBuffer[frameI - 2] !== 0) {
            frameI++;
            break;
          }

          if (frameSyncPoint + 3 !== frameI - 2) {
            nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);

            if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
              foundKeyFrame = true;
            }
          } // drop trailing zeroes


          do {
            frameI++;
          } while (frameBuffer[frameI] !== 1 && frameI < frameBuffer.length);

          frameSyncPoint = frameI - 2;
          frameI += 3;
          break;

        case 1:
          // skip past non-sync sequences
          if (frameBuffer[frameI - 1] !== 0 || frameBuffer[frameI - 2] !== 0) {
            frameI += 3;
            break;
          }

          nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);

          if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
            foundKeyFrame = true;
          }

          frameSyncPoint = frameI - 2;
          frameI += 3;
          break;

        default:
          // the current byte isn't a one or zero, so it cannot be part
          // of a sync sequence
          frameI += 3;
          break;
      }
    }

    frameBuffer = frameBuffer.subarray(frameSyncPoint);
    frameI -= frameSyncPoint;
    frameSyncPoint = 0; // parse the final nal

    if (frameBuffer && frameBuffer.byteLength > 3) {
      nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);

      if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
        foundKeyFrame = true;
      }
    }

    return foundKeyFrame;
  };

  var probe$1 = {
    parseType: parseType,
    parsePat: parsePat,
    parsePmt: parsePmt,
    parsePayloadUnitStartIndicator: parsePayloadUnitStartIndicator,
    parsePesType: parsePesType,
    parsePesTime: parsePesTime,
    videoPacketContainsKeyFrame: videoPacketContainsKeyFrame
  };
  var handleRollover = timestampRolloverStream.handleRollover;
  var probe = {};
  probe.ts = probe$1;
  probe.aac = utils;
  var ONE_SECOND_IN_TS = clock.ONE_SECOND_IN_TS;
  var MP2T_PACKET_LENGTH = 188,
      // bytes
  SYNC_BYTE = 0x47;
  /**
   * walks through segment data looking for pat and pmt packets to parse out
   * program map table information
   */

  var parsePsi_ = function parsePsi_(bytes, pmt) {
    var startIndex = 0,
        endIndex = MP2T_PACKET_LENGTH,
        packet,
        type;

    while (endIndex < bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        packet = bytes.subarray(startIndex, endIndex);
        type = probe.ts.parseType(packet, pmt.pid);

        switch (type) {
          case 'pat':
            pmt.pid = probe.ts.parsePat(packet);
            break;

          case 'pmt':
            var table = probe.ts.parsePmt(packet);
            pmt.table = pmt.table || {};
            Object.keys(table).forEach(function (key) {
              pmt.table[key] = table[key];
            });
            break;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      } // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet


      startIndex++;
      endIndex++;
    }
  };
  /**
   * walks through the segment data from the start and end to get timing information
   * for the first and last audio pes packets
   */


  var parseAudioPes_ = function parseAudioPes_(bytes, pmt, result) {
    var startIndex = 0,
        endIndex = MP2T_PACKET_LENGTH,
        packet,
        type,
        pesType,
        pusi,
        parsed;
    var endLoop = false; // Start walking from start of segment to get first audio packet

    while (endIndex <= bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && (bytes[endIndex] === SYNC_BYTE || endIndex === bytes.byteLength)) {
        // We found a packet
        packet = bytes.subarray(startIndex, endIndex);
        type = probe.ts.parseType(packet, pmt.pid);

        switch (type) {
          case 'pes':
            pesType = probe.ts.parsePesType(packet, pmt.table);
            pusi = probe.ts.parsePayloadUnitStartIndicator(packet);

            if (pesType === 'audio' && pusi) {
              parsed = probe.ts.parsePesTime(packet);

              if (parsed) {
                parsed.type = 'audio';
                result.audio.push(parsed);
                endLoop = true;
              }
            }

            break;
        }

        if (endLoop) {
          break;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      } // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet


      startIndex++;
      endIndex++;
    } // Start walking from end of segment to get last audio packet


    endIndex = bytes.byteLength;
    startIndex = endIndex - MP2T_PACKET_LENGTH;
    endLoop = false;

    while (startIndex >= 0) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && (bytes[endIndex] === SYNC_BYTE || endIndex === bytes.byteLength)) {
        // We found a packet
        packet = bytes.subarray(startIndex, endIndex);
        type = probe.ts.parseType(packet, pmt.pid);

        switch (type) {
          case 'pes':
            pesType = probe.ts.parsePesType(packet, pmt.table);
            pusi = probe.ts.parsePayloadUnitStartIndicator(packet);

            if (pesType === 'audio' && pusi) {
              parsed = probe.ts.parsePesTime(packet);

              if (parsed) {
                parsed.type = 'audio';
                result.audio.push(parsed);
                endLoop = true;
              }
            }

            break;
        }

        if (endLoop) {
          break;
        }

        startIndex -= MP2T_PACKET_LENGTH;
        endIndex -= MP2T_PACKET_LENGTH;
        continue;
      } // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet


      startIndex--;
      endIndex--;
    }
  };
  /**
   * walks through the segment data from the start and end to get timing information
   * for the first and last video pes packets as well as timing information for the first
   * key frame.
   */


  var parseVideoPes_ = function parseVideoPes_(bytes, pmt, result) {
    var startIndex = 0,
        endIndex = MP2T_PACKET_LENGTH,
        packet,
        type,
        pesType,
        pusi,
        parsed,
        frame,
        i,
        pes;
    var endLoop = false;
    var currentFrame = {
      data: [],
      size: 0
    }; // Start walking from start of segment to get first video packet

    while (endIndex < bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        packet = bytes.subarray(startIndex, endIndex);
        type = probe.ts.parseType(packet, pmt.pid);

        switch (type) {
          case 'pes':
            pesType = probe.ts.parsePesType(packet, pmt.table);
            pusi = probe.ts.parsePayloadUnitStartIndicator(packet);

            if (pesType === 'video') {
              if (pusi && !endLoop) {
                parsed = probe.ts.parsePesTime(packet);

                if (parsed) {
                  parsed.type = 'video';
                  result.video.push(parsed);
                  endLoop = true;
                }
              }

              if (!result.firstKeyFrame) {
                if (pusi) {
                  if (currentFrame.size !== 0) {
                    frame = new Uint8Array(currentFrame.size);
                    i = 0;

                    while (currentFrame.data.length) {
                      pes = currentFrame.data.shift();
                      frame.set(pes, i);
                      i += pes.byteLength;
                    }

                    if (probe.ts.videoPacketContainsKeyFrame(frame)) {
                      var firstKeyFrame = probe.ts.parsePesTime(frame); // PTS/DTS may not be available. Simply *not* setting
                      // the keyframe seems to work fine with HLS playback
                      // and definitely preferable to a crash with TypeError...

                      if (firstKeyFrame) {
                        result.firstKeyFrame = firstKeyFrame;
                        result.firstKeyFrame.type = 'video';
                      } else {
                        // eslint-disable-next-line
                        console.warn('Failed to extract PTS/DTS from PES at first keyframe. ' + 'This could be an unusual TS segment, or else mux.js did not ' + 'parse your TS segment correctly. If you know your TS ' + 'segments do contain PTS/DTS on keyframes please file a bug ' + 'report! You can try ffprobe to double check for yourself.');
                      }
                    }

                    currentFrame.size = 0;
                  }
                }

                currentFrame.data.push(packet);
                currentFrame.size += packet.byteLength;
              }
            }

            break;
        }

        if (endLoop && result.firstKeyFrame) {
          break;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      } // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet


      startIndex++;
      endIndex++;
    } // Start walking from end of segment to get last video packet


    endIndex = bytes.byteLength;
    startIndex = endIndex - MP2T_PACKET_LENGTH;
    endLoop = false;

    while (startIndex >= 0) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        packet = bytes.subarray(startIndex, endIndex);
        type = probe.ts.parseType(packet, pmt.pid);

        switch (type) {
          case 'pes':
            pesType = probe.ts.parsePesType(packet, pmt.table);
            pusi = probe.ts.parsePayloadUnitStartIndicator(packet);

            if (pesType === 'video' && pusi) {
              parsed = probe.ts.parsePesTime(packet);

              if (parsed) {
                parsed.type = 'video';
                result.video.push(parsed);
                endLoop = true;
              }
            }

            break;
        }

        if (endLoop) {
          break;
        }

        startIndex -= MP2T_PACKET_LENGTH;
        endIndex -= MP2T_PACKET_LENGTH;
        continue;
      } // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet


      startIndex--;
      endIndex--;
    }
  };
  /**
   * Adjusts the timestamp information for the segment to account for
   * rollover and convert to seconds based on pes packet timescale (90khz clock)
   */


  var adjustTimestamp_ = function adjustTimestamp_(segmentInfo, baseTimestamp) {
    if (segmentInfo.audio && segmentInfo.audio.length) {
      var audioBaseTimestamp = baseTimestamp;

      if (typeof audioBaseTimestamp === 'undefined' || isNaN(audioBaseTimestamp)) {
        audioBaseTimestamp = segmentInfo.audio[0].dts;
      }

      segmentInfo.audio.forEach(function (info) {
        info.dts = handleRollover(info.dts, audioBaseTimestamp);
        info.pts = handleRollover(info.pts, audioBaseTimestamp); // time in seconds

        info.dtsTime = info.dts / ONE_SECOND_IN_TS;
        info.ptsTime = info.pts / ONE_SECOND_IN_TS;
      });
    }

    if (segmentInfo.video && segmentInfo.video.length) {
      var videoBaseTimestamp = baseTimestamp;

      if (typeof videoBaseTimestamp === 'undefined' || isNaN(videoBaseTimestamp)) {
        videoBaseTimestamp = segmentInfo.video[0].dts;
      }

      segmentInfo.video.forEach(function (info) {
        info.dts = handleRollover(info.dts, videoBaseTimestamp);
        info.pts = handleRollover(info.pts, videoBaseTimestamp); // time in seconds

        info.dtsTime = info.dts / ONE_SECOND_IN_TS;
        info.ptsTime = info.pts / ONE_SECOND_IN_TS;
      });

      if (segmentInfo.firstKeyFrame) {
        var frame = segmentInfo.firstKeyFrame;
        frame.dts = handleRollover(frame.dts, videoBaseTimestamp);
        frame.pts = handleRollover(frame.pts, videoBaseTimestamp); // time in seconds

        frame.dtsTime = frame.dts / ONE_SECOND_IN_TS;
        frame.ptsTime = frame.pts / ONE_SECOND_IN_TS;
      }
    }
  };
  /**
   * inspects the aac data stream for start and end time information
   */


  var inspectAac_ = function inspectAac_(bytes) {
    var endLoop = false,
        audioCount = 0,
        sampleRate = null,
        timestamp = null,
        frameSize = 0,
        byteIndex = 0,
        packet;

    while (bytes.length - byteIndex >= 3) {
      var type = probe.aac.parseType(bytes, byteIndex);

      switch (type) {
        case 'timed-metadata':
          // Exit early because we don't have enough to parse
          // the ID3 tag header
          if (bytes.length - byteIndex < 10) {
            endLoop = true;
            break;
          }

          frameSize = probe.aac.parseId3TagSize(bytes, byteIndex); // Exit early if we don't have enough in the buffer
          // to emit a full packet

          if (frameSize > bytes.length) {
            endLoop = true;
            break;
          }

          if (timestamp === null) {
            packet = bytes.subarray(byteIndex, byteIndex + frameSize);
            timestamp = probe.aac.parseAacTimestamp(packet);
          }

          byteIndex += frameSize;
          break;

        case 'audio':
          // Exit early because we don't have enough to parse
          // the ADTS frame header
          if (bytes.length - byteIndex < 7) {
            endLoop = true;
            break;
          }

          frameSize = probe.aac.parseAdtsSize(bytes, byteIndex); // Exit early if we don't have enough in the buffer
          // to emit a full packet

          if (frameSize > bytes.length) {
            endLoop = true;
            break;
          }

          if (sampleRate === null) {
            packet = bytes.subarray(byteIndex, byteIndex + frameSize);
            sampleRate = probe.aac.parseSampleRate(packet);
          }

          audioCount++;
          byteIndex += frameSize;
          break;

        default:
          byteIndex++;
          break;
      }

      if (endLoop) {
        return null;
      }
    }

    if (sampleRate === null || timestamp === null) {
      return null;
    }

    var audioTimescale = ONE_SECOND_IN_TS / sampleRate;
    var result = {
      audio: [{
        type: 'audio',
        dts: timestamp,
        pts: timestamp
      }, {
        type: 'audio',
        dts: timestamp + audioCount * 1024 * audioTimescale,
        pts: timestamp + audioCount * 1024 * audioTimescale
      }]
    };
    return result;
  };
  /**
   * inspects the transport stream segment data for start and end time information
   * of the audio and video tracks (when present) as well as the first key frame's
   * start time.
   */


  var inspectTs_ = function inspectTs_(bytes) {
    var pmt = {
      pid: null,
      table: null
    };
    var result = {};
    parsePsi_(bytes, pmt);

    for (var pid in pmt.table) {
      if (pmt.table.hasOwnProperty(pid)) {
        var type = pmt.table[pid];

        switch (type) {
          case streamTypes.H264_STREAM_TYPE:
            result.video = [];
            parseVideoPes_(bytes, pmt, result);

            if (result.video.length === 0) {
              delete result.video;
            }

            break;

          case streamTypes.ADTS_STREAM_TYPE:
            result.audio = [];
            parseAudioPes_(bytes, pmt, result);

            if (result.audio.length === 0) {
              delete result.audio;
            }

            break;
        }
      }
    }

    return result;
  };
  /**
   * Inspects segment byte data and returns an object with start and end timing information
   *
   * @param {Uint8Array} bytes The segment byte data
   * @param {Number} baseTimestamp Relative reference timestamp used when adjusting frame
   *  timestamps for rollover. This value must be in 90khz clock.
   * @return {Object} Object containing start and end frame timing info of segment.
   */


  var inspect = function inspect(bytes, baseTimestamp) {
    var isAacData = probe.aac.isLikelyAacData(bytes);
    var result;

    if (isAacData) {
      result = inspectAac_(bytes);
    } else {
      result = inspectTs_(bytes);
    }

    if (!result || !result.audio && !result.video) {
      return null;
    }

    adjustTimestamp_(result, baseTimestamp);
    return result;
  };

  var tsInspector = {
    inspect: inspect,
    parseAudioPes_: parseAudioPes_
  };
  /* global self */

  /**
   * Re-emits transmuxer events by converting them into messages to the
   * world outside the worker.
   *
   * @param {Object} transmuxer the transmuxer to wire events on
   * @private
   */

  var wireTransmuxerEvents = function wireTransmuxerEvents(self, transmuxer) {
    transmuxer.on('data', function (segment) {
      // transfer ownership of the underlying ArrayBuffer
      // instead of doing a copy to save memory
      // ArrayBuffers are transferable but generic TypedArrays are not
      // @link https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#Passing_data_by_transferring_ownership_(transferable_objects)
      var initArray = segment.initSegment;
      segment.initSegment = {
        data: initArray.buffer,
        byteOffset: initArray.byteOffset,
        byteLength: initArray.byteLength
      };
      var typedArray = segment.data;
      segment.data = typedArray.buffer;
      self.postMessage({
        action: 'data',
        segment: segment,
        byteOffset: typedArray.byteOffset,
        byteLength: typedArray.byteLength
      }, [segment.data]);
    });
    transmuxer.on('done', function (data) {
      self.postMessage({
        action: 'done'
      });
    });
    transmuxer.on('gopInfo', function (gopInfo) {
      self.postMessage({
        action: 'gopInfo',
        gopInfo: gopInfo
      });
    });
    transmuxer.on('videoSegmentTimingInfo', function (timingInfo) {
      var videoSegmentTimingInfo = {
        start: {
          decode: clock.videoTsToSeconds(timingInfo.start.dts),
          presentation: clock.videoTsToSeconds(timingInfo.start.pts)
        },
        end: {
          decode: clock.videoTsToSeconds(timingInfo.end.dts),
          presentation: clock.videoTsToSeconds(timingInfo.end.pts)
        },
        baseMediaDecodeTime: clock.videoTsToSeconds(timingInfo.baseMediaDecodeTime)
      };

      if (timingInfo.prependedContentDuration) {
        videoSegmentTimingInfo.prependedContentDuration = clock.videoTsToSeconds(timingInfo.prependedContentDuration);
      }

      self.postMessage({
        action: 'videoSegmentTimingInfo',
        videoSegmentTimingInfo: videoSegmentTimingInfo
      });
    });
    transmuxer.on('audioSegmentTimingInfo', function (timingInfo) {
      // Note that all times for [audio/video]SegmentTimingInfo events are in video clock
      var audioSegmentTimingInfo = {
        start: {
          decode: clock.videoTsToSeconds(timingInfo.start.dts),
          presentation: clock.videoTsToSeconds(timingInfo.start.pts)
        },
        end: {
          decode: clock.videoTsToSeconds(timingInfo.end.dts),
          presentation: clock.videoTsToSeconds(timingInfo.end.pts)
        },
        baseMediaDecodeTime: clock.videoTsToSeconds(timingInfo.baseMediaDecodeTime)
      };

      if (timingInfo.prependedContentDuration) {
        audioSegmentTimingInfo.prependedContentDuration = clock.videoTsToSeconds(timingInfo.prependedContentDuration);
      }

      self.postMessage({
        action: 'audioSegmentTimingInfo',
        audioSegmentTimingInfo: audioSegmentTimingInfo
      });
    });
    transmuxer.on('id3Frame', function (id3Frame) {
      self.postMessage({
        action: 'id3Frame',
        id3Frame: id3Frame
      });
    });
    transmuxer.on('caption', function (caption) {
      self.postMessage({
        action: 'caption',
        caption: caption
      });
    });
    transmuxer.on('trackinfo', function (trackInfo) {
      self.postMessage({
        action: 'trackinfo',
        trackInfo: trackInfo
      });
    });
    transmuxer.on('audioTimingInfo', function (audioTimingInfo) {
      // convert to video TS since we prioritize video time over audio
      self.postMessage({
        action: 'audioTimingInfo',
        audioTimingInfo: {
          start: clock.videoTsToSeconds(audioTimingInfo.start),
          end: clock.videoTsToSeconds(audioTimingInfo.end)
        }
      });
    });
    transmuxer.on('videoTimingInfo', function (videoTimingInfo) {
      self.postMessage({
        action: 'videoTimingInfo',
        videoTimingInfo: {
          start: clock.videoTsToSeconds(videoTimingInfo.start),
          end: clock.videoTsToSeconds(videoTimingInfo.end)
        }
      });
    });
    transmuxer.on('log', function (log) {
      self.postMessage({
        action: 'log',
        log: log
      });
    });
  };
  /**
   * All incoming messages route through this hash. If no function exists
   * to handle an incoming message, then we ignore the message.
   *
   * @class MessageHandlers
   * @param {Object} options the options to initialize with
   */


  var MessageHandlers = /*#__PURE__*/function () {
    function MessageHandlers(self, options) {
      this.options = options || {};
      this.self = self;
      this.init();
    }
    /**
     * initialize our web worker and wire all the events.
     */


    var _proto = MessageHandlers.prototype;

    _proto.init = function init() {
      if (this.transmuxer) {
        this.transmuxer.dispose();
      }

      this.transmuxer = new transmuxer.Transmuxer(this.options);
      wireTransmuxerEvents(this.self, this.transmuxer);
    };

    _proto.pushMp4Captions = function pushMp4Captions(data) {
      if (!this.captionParser) {
        this.captionParser = new captionParser();
        this.captionParser.init();
      }

      var segment = new Uint8Array(data.data, data.byteOffset, data.byteLength);
      var parsed = this.captionParser.parse(segment, data.trackIds, data.timescales);
      this.self.postMessage({
        action: 'mp4Captions',
        captions: parsed && parsed.captions || [],
        logs: parsed && parsed.logs || [],
        data: segment.buffer
      }, [segment.buffer]);
    };

    _proto.probeMp4StartTime = function probeMp4StartTime(_ref) {
      var timescales = _ref.timescales,
          data = _ref.data;
      var startTime = probe$2.startTime(timescales, data);
      this.self.postMessage({
        action: 'probeMp4StartTime',
        startTime: startTime,
        data: data
      }, [data.buffer]);
    };

    _proto.probeMp4Tracks = function probeMp4Tracks(_ref2) {
      var data = _ref2.data;
      var tracks = probe$2.tracks(data);
      this.self.postMessage({
        action: 'probeMp4Tracks',
        tracks: tracks,
        data: data
      }, [data.buffer]);
    }
    /**
     * Probes an mp4 segment for EMSG boxes containing ID3 data.
     * https://aomediacodec.github.io/id3-emsg/
     *
     * @param {Uint8Array} data segment data
     * @param {number} offset segment start time
     * @return {Object[]} an array of ID3 frames
     */
    ;

    _proto.probeEmsgID3 = function probeEmsgID3(_ref3) {
      var data = _ref3.data,
          offset = _ref3.offset;
      var id3Frames = probe$2.getEmsgID3(data, offset);
      this.self.postMessage({
        action: 'probeEmsgID3',
        id3Frames: id3Frames,
        emsgData: data
      }, [data.buffer]);
    }
    /**
     * Probe an mpeg2-ts segment to determine the start time of the segment in it's
     * internal "media time," as well as whether it contains video and/or audio.
     *
     * @private
     * @param {Uint8Array} bytes - segment bytes
     * @param {number} baseStartTime
     *        Relative reference timestamp used when adjusting frame timestamps for rollover.
     *        This value should be in seconds, as it's converted to a 90khz clock within the
     *        function body.
     * @return {Object} The start time of the current segment in "media time" as well as
     *                  whether it contains video and/or audio
     */
    ;

    _proto.probeTs = function probeTs(_ref4) {
      var data = _ref4.data,
          baseStartTime = _ref4.baseStartTime;
      var tsStartTime = typeof baseStartTime === 'number' && !isNaN(baseStartTime) ? baseStartTime * clock.ONE_SECOND_IN_TS : void 0;
      var timeInfo = tsInspector.inspect(data, tsStartTime);
      var result = null;

      if (timeInfo) {
        result = {
          // each type's time info comes back as an array of 2 times, start and end
          hasVideo: timeInfo.video && timeInfo.video.length === 2 || false,
          hasAudio: timeInfo.audio && timeInfo.audio.length === 2 || false
        };

        if (result.hasVideo) {
          result.videoStart = timeInfo.video[0].ptsTime;
        }

        if (result.hasAudio) {
          result.audioStart = timeInfo.audio[0].ptsTime;
        }
      }

      this.self.postMessage({
        action: 'probeTs',
        result: result,
        data: data
      }, [data.buffer]);
    };

    _proto.clearAllMp4Captions = function clearAllMp4Captions() {
      if (this.captionParser) {
        this.captionParser.clearAllCaptions();
      }
    };

    _proto.clearParsedMp4Captions = function clearParsedMp4Captions() {
      if (this.captionParser) {
        this.captionParser.clearParsedCaptions();
      }
    }
    /**
     * Adds data (a ts segment) to the start of the transmuxer pipeline for
     * processing.
     *
     * @param {ArrayBuffer} data data to push into the muxer
     */
    ;

    _proto.push = function push(data) {
      // Cast array buffer to correct type for transmuxer
      var segment = new Uint8Array(data.data, data.byteOffset, data.byteLength);
      this.transmuxer.push(segment);
    }
    /**
     * Recreate the transmuxer so that the next segment added via `push`
     * start with a fresh transmuxer.
     */
    ;

    _proto.reset = function reset() {
      this.transmuxer.reset();
    }
    /**
     * Set the value that will be used as the `baseMediaDecodeTime` time for the
     * next segment pushed in. Subsequent segments will have their `baseMediaDecodeTime`
     * set relative to the first based on the PTS values.
     *
     * @param {Object} data used to set the timestamp offset in the muxer
     */
    ;

    _proto.setTimestampOffset = function setTimestampOffset(data) {
      var timestampOffset = data.timestampOffset || 0;
      this.transmuxer.setBaseMediaDecodeTime(Math.round(clock.secondsToVideoTs(timestampOffset)));
    };

    _proto.setAudioAppendStart = function setAudioAppendStart(data) {
      this.transmuxer.setAudioAppendStart(Math.ceil(clock.secondsToVideoTs(data.appendStart)));
    };

    _proto.setRemux = function setRemux(data) {
      this.transmuxer.setRemux(data.remux);
    }
    /**
     * Forces the pipeline to finish processing the last segment and emit it's
     * results.
     *
     * @param {Object} data event data, not really used
     */
    ;

    _proto.flush = function flush(data) {
      this.transmuxer.flush(); // transmuxed done action is fired after both audio/video pipelines are flushed

      self.postMessage({
        action: 'done',
        type: 'transmuxed'
      });
    };

    _proto.endTimeline = function endTimeline() {
      this.transmuxer.endTimeline(); // transmuxed endedtimeline action is fired after both audio/video pipelines end their
      // timelines

      self.postMessage({
        action: 'endedtimeline',
        type: 'transmuxed'
      });
    };

    _proto.alignGopsWith = function alignGopsWith(data) {
      this.transmuxer.alignGopsWith(data.gopsToAlignWith.slice());
    };

    return MessageHandlers;
  }();
  /**
   * Our web worker interface so that things can talk to mux.js
   * that will be running in a web worker. the scope is passed to this by
   * webworkify.
   *
   * @param {Object} self the scope for the web worker
   */


  self.onmessage = function (event) {
    if (event.data.action === 'init' && event.data.options) {
      this.messageHandlers = new MessageHandlers(self, event.data.options);
      return;
    }

    if (!this.messageHandlers) {
      this.messageHandlers = new MessageHandlers(self);
    }

    if (event.data && event.data.action && event.data.action !== 'init') {
      if (this.messageHandlers[event.data.action]) {
        this.messageHandlers[event.data.action](event.data);
      }
    }
  };
}));
var TransmuxWorker = factory(workerCode$1);
/* rollup-plugin-worker-factory end for worker!C:\Users\pjaspinski\Desktop\tellyo\http-streaming\src\transmuxer-worker.js */

var handleData_ = function handleData_(event, transmuxedData, callback) {
  var _event$data$segment = event.data.segment,
      type = _event$data$segment.type,
      initSegment = _event$data$segment.initSegment,
      captions = _event$data$segment.captions,
      captionStreams = _event$data$segment.captionStreams,
      metadata = _event$data$segment.metadata,
      videoFrameDtsTime = _event$data$segment.videoFrameDtsTime,
      videoFramePtsTime = _event$data$segment.videoFramePtsTime;
  transmuxedData.buffer.push({
    captions: captions,
    captionStreams: captionStreams,
    metadata: metadata
  });
  var boxes = event.data.segment.boxes || {
    data: event.data.segment.data
  };
  var result = {
    type: type,
    // cast ArrayBuffer to TypedArray
    data: new Uint8Array(boxes.data, boxes.data.byteOffset, boxes.data.byteLength),
    initSegment: new Uint8Array(initSegment.data, initSegment.byteOffset, initSegment.byteLength)
  };

  if (typeof videoFrameDtsTime !== 'undefined') {
    result.videoFrameDtsTime = videoFrameDtsTime;
  }

  if (typeof videoFramePtsTime !== 'undefined') {
    result.videoFramePtsTime = videoFramePtsTime;
  }

  callback(result);
};
var handleDone_ = function handleDone_(_ref) {
  var transmuxedData = _ref.transmuxedData,
      callback = _ref.callback;
  // Previously we only returned data on data events,
  // not on done events. Clear out the buffer to keep that consistent.
  transmuxedData.buffer = []; // all buffers should have been flushed from the muxer, so start processing anything we
  // have received

  callback(transmuxedData);
};
var handleGopInfo_ = function handleGopInfo_(event, transmuxedData) {
  transmuxedData.gopInfo = event.data.gopInfo;
};
var processTransmux = function processTransmux(options) {
  var transmuxer = options.transmuxer,
      bytes = options.bytes,
      audioAppendStart = options.audioAppendStart,
      gopsToAlignWith = options.gopsToAlignWith,
      remux = options.remux,
      onData = options.onData,
      onTrackInfo = options.onTrackInfo,
      onAudioTimingInfo = options.onAudioTimingInfo,
      onVideoTimingInfo = options.onVideoTimingInfo,
      onVideoSegmentTimingInfo = options.onVideoSegmentTimingInfo,
      onAudioSegmentTimingInfo = options.onAudioSegmentTimingInfo,
      onId3 = options.onId3,
      onCaptions = options.onCaptions,
      onDone = options.onDone,
      onEndedTimeline = options.onEndedTimeline,
      onTransmuxerLog = options.onTransmuxerLog,
      isEndOfTimeline = options.isEndOfTimeline;
  var transmuxedData = {
    buffer: []
  };
  var waitForEndedTimelineEvent = isEndOfTimeline;

  var handleMessage = function handleMessage(event) {
    if (transmuxer.currentTransmux !== options) {
      // disposed
      return;
    }

    if (event.data.action === 'data') {
      handleData_(event, transmuxedData, onData);
    }

    if (event.data.action === 'trackinfo') {
      onTrackInfo(event.data.trackInfo);
    }

    if (event.data.action === 'gopInfo') {
      handleGopInfo_(event, transmuxedData);
    }

    if (event.data.action === 'audioTimingInfo') {
      onAudioTimingInfo(event.data.audioTimingInfo);
    }

    if (event.data.action === 'videoTimingInfo') {
      onVideoTimingInfo(event.data.videoTimingInfo);
    }

    if (event.data.action === 'videoSegmentTimingInfo') {
      onVideoSegmentTimingInfo(event.data.videoSegmentTimingInfo);
    }

    if (event.data.action === 'audioSegmentTimingInfo') {
      onAudioSegmentTimingInfo(event.data.audioSegmentTimingInfo);
    }

    if (event.data.action === 'id3Frame') {
      onId3([event.data.id3Frame], event.data.id3Frame.dispatchType);
    }

    if (event.data.action === 'caption') {
      onCaptions(event.data.caption);
    }

    if (event.data.action === 'endedtimeline') {
      waitForEndedTimelineEvent = false;
      onEndedTimeline();
    }

    if (event.data.action === 'log') {
      onTransmuxerLog(event.data.log);
    } // wait for the transmuxed event since we may have audio and video


    if (event.data.type !== 'transmuxed') {
      return;
    } // If the "endedtimeline" event has not yet fired, and this segment represents the end
    // of a timeline, that means there may still be data events before the segment
    // processing can be considerred complete. In that case, the final event should be
    // an "endedtimeline" event with the type "transmuxed."


    if (waitForEndedTimelineEvent) {
      return;
    }

    transmuxer.onmessage = null;
    handleDone_({
      transmuxedData: transmuxedData,
      callback: onDone
    });
    /* eslint-disable no-use-before-define */

    dequeue(transmuxer);
    /* eslint-enable */
  };

  transmuxer.onmessage = handleMessage;

  if (audioAppendStart) {
    transmuxer.postMessage({
      action: 'setAudioAppendStart',
      appendStart: audioAppendStart
    });
  } // allow empty arrays to be passed to clear out GOPs


  if (Array.isArray(gopsToAlignWith)) {
    transmuxer.postMessage({
      action: 'alignGopsWith',
      gopsToAlignWith: gopsToAlignWith
    });
  }

  if (typeof remux !== 'undefined') {
    transmuxer.postMessage({
      action: 'setRemux',
      remux: remux
    });
  }

  if (bytes.byteLength) {
    var buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    var byteOffset = bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset;
    transmuxer.postMessage({
      action: 'push',
      // Send the typed-array of data as an ArrayBuffer so that
      // it can be sent as a "Transferable" and avoid the costly
      // memory copy
      data: buffer,
      // To recreate the original typed-array, we need information
      // about what portion of the ArrayBuffer it was a view into
      byteOffset: byteOffset,
      byteLength: bytes.byteLength
    }, [buffer]);
  }

  if (isEndOfTimeline) {
    transmuxer.postMessage({
      action: 'endTimeline'
    });
  } // even if we didn't push any bytes, we have to make sure we flush in case we reached
  // the end of the segment


  transmuxer.postMessage({
    action: 'flush'
  });
};
var dequeue = function dequeue(transmuxer) {
  transmuxer.currentTransmux = null;

  if (transmuxer.transmuxQueue.length) {
    transmuxer.currentTransmux = transmuxer.transmuxQueue.shift();

    if (typeof transmuxer.currentTransmux === 'function') {
      transmuxer.currentTransmux();
    } else {
      processTransmux(transmuxer.currentTransmux);
    }
  }
};
var processAction = function processAction(transmuxer, action) {
  transmuxer.postMessage({
    action: action
  });
  dequeue(transmuxer);
};
var enqueueAction = function enqueueAction(action, transmuxer) {
  if (!transmuxer.currentTransmux) {
    transmuxer.currentTransmux = action;
    processAction(transmuxer, action);
    return;
  }

  transmuxer.transmuxQueue.push(processAction.bind(null, transmuxer, action));
};
var reset = function reset(transmuxer) {
  enqueueAction('reset', transmuxer);
};
var endTimeline = function endTimeline(transmuxer) {
  enqueueAction('endTimeline', transmuxer);
};
var transmux = function transmux(options) {
  if (!options.transmuxer.currentTransmux) {
    options.transmuxer.currentTransmux = options;
    processTransmux(options);
    return;
  }

  options.transmuxer.transmuxQueue.push(options);
};
var createTransmuxer = function createTransmuxer(options) {
  var transmuxer = new TransmuxWorker();
  transmuxer.currentTransmux = null;
  transmuxer.transmuxQueue = [];
  var term = transmuxer.terminate;

  transmuxer.terminate = function () {
    transmuxer.currentTransmux = null;
    transmuxer.transmuxQueue.length = 0;
    return term.call(transmuxer);
  };

  transmuxer.postMessage({
    action: 'init',
    options: options
  });
  return transmuxer;
};
var segmentTransmuxer = {
  reset: reset,
  endTimeline: endTimeline,
  transmux: transmux,
  createTransmuxer: createTransmuxer
};

var workerCallback = function workerCallback(options) {
  var transmuxer = options.transmuxer;
  var endAction = options.endAction || options.action;
  var callback = options.callback;

  var message = _extends({}, options, {
    endAction: null,
    transmuxer: null,
    callback: null
  });

  var listenForEndEvent = function listenForEndEvent(event) {
    if (event.data.action !== endAction) {
      return;
    }

    transmuxer.removeEventListener('message', listenForEndEvent); // transfer ownership of bytes back to us.

    if (event.data.data) {
      event.data.data = new Uint8Array(event.data.data, options.byteOffset || 0, options.byteLength || event.data.data.byteLength);

      if (options.data) {
        options.data = event.data.data;
      }
    }

    callback(event.data);
  };

  transmuxer.addEventListener('message', listenForEndEvent);

  if (options.data) {
    var isArrayBuffer = options.data instanceof ArrayBuffer;
    message.byteOffset = isArrayBuffer ? 0 : options.data.byteOffset;
    message.byteLength = options.data.byteLength;
    var transfers = [isArrayBuffer ? options.data : options.data.buffer];
    transmuxer.postMessage(message, transfers);
  } else {
    transmuxer.postMessage(message);
  }
};

var REQUEST_ERRORS = {
  FAILURE: 2,
  TIMEOUT: -101,
  ABORTED: -102
};
/**
 * Abort all requests
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 */

var abortAll = function abortAll(activeXhrs) {
  activeXhrs.forEach(function (xhr) {
    xhr.abort();
  });
};
/**
 * Gather important bandwidth stats once a request has completed
 *
 * @param {Object} request - the XHR request from which to gather stats
 */


var getRequestStats = function getRequestStats(request) {
  return {
    bandwidth: request.bandwidth,
    bytesReceived: request.bytesReceived || 0,
    roundTripTime: request.roundTripTime || 0
  };
};
/**
 * If possible gather bandwidth stats as a request is in
 * progress
 *
 * @param {Event} progressEvent - an event object from an XHR's progress event
 */


var getProgressStats = function getProgressStats(progressEvent) {
  var request = progressEvent.target;
  var roundTripTime = Date.now() - request.requestTime;
  var stats = {
    bandwidth: Infinity,
    bytesReceived: 0,
    roundTripTime: roundTripTime || 0
  };
  stats.bytesReceived = progressEvent.loaded; // This can result in Infinity if stats.roundTripTime is 0 but that is ok
  // because we should only use bandwidth stats on progress to determine when
  // abort a request early due to insufficient bandwidth

  stats.bandwidth = Math.floor(stats.bytesReceived / stats.roundTripTime * 8 * 1000);
  return stats;
};
/**
 * Handle all error conditions in one place and return an object
 * with all the information
 *
 * @param {Error|null} error - if non-null signals an error occured with the XHR
 * @param {Object} request -  the XHR request that possibly generated the error
 */


var handleErrors = function handleErrors(error, request) {
  if (request.timedout) {
    return {
      status: request.status,
      message: 'HLS request timed-out at URL: ' + request.uri,
      code: REQUEST_ERRORS.TIMEOUT,
      xhr: request
    };
  }

  if (request.aborted) {
    return {
      status: request.status,
      message: 'HLS request aborted at URL: ' + request.uri,
      code: REQUEST_ERRORS.ABORTED,
      xhr: request
    };
  }

  if (error) {
    return {
      status: request.status,
      message: 'HLS request errored at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    };
  }

  if (request.responseType === 'arraybuffer' && request.response.byteLength === 0) {
    return {
      status: request.status,
      message: 'Empty HLS response at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    };
  }

  return null;
};
/**
 * Handle responses for key data and convert the key data to the correct format
 * for the decryption step later
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Array} objects - objects to add the key bytes to.
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */


var handleKeyResponse = function handleKeyResponse(segment, objects, finishProcessingFn) {
  return function (error, request) {
    var response = request.response;
    var errorObj = handleErrors(error, request);

    if (errorObj) {
      return finishProcessingFn(errorObj, segment);
    }

    if (response.byteLength !== 16) {
      return finishProcessingFn({
        status: request.status,
        message: 'Invalid HLS key at URL: ' + request.uri,
        code: REQUEST_ERRORS.FAILURE,
        xhr: request
      }, segment);
    }

    var view = new DataView(response);
    var bytes = new Uint32Array([view.getUint32(0), view.getUint32(4), view.getUint32(8), view.getUint32(12)]);

    for (var i = 0; i < objects.length; i++) {
      objects[i].bytes = bytes;
    }

    return finishProcessingFn(null, segment);
  };
};

var parseInitSegment = function parseInitSegment(segment, _callback) {
  var type = detectContainerForBytes(segment.map.bytes); // TODO: We should also handle ts init segments here, but we
  // only know how to parse mp4 init segments at the moment

  if (type !== 'mp4') {
    var uri = segment.map.resolvedUri || segment.map.uri;
    var mediaType = type || 'unknown';
    return _callback({
      internal: true,
      message: "Found unsupported " + mediaType + " container for initialization segment at URL: " + uri,
      code: REQUEST_ERRORS.FAILURE,
      metadata: {
        errorType: videojs.Error.UnsupportedMediaInitialization,
        mediaType: mediaType
      }
    });
  }

  workerCallback({
    action: 'probeMp4Tracks',
    data: segment.map.bytes,
    transmuxer: segment.transmuxer,
    callback: function callback(_ref) {
      var tracks = _ref.tracks,
          data = _ref.data;
      // transfer bytes back to us
      segment.map.bytes = data;
      tracks.forEach(function (track) {
        segment.map.tracks = segment.map.tracks || {}; // only support one track of each type for now

        if (segment.map.tracks[track.type]) {
          return;
        }

        segment.map.tracks[track.type] = track;

        if (typeof track.id === 'number' && track.timescale) {
          segment.map.timescales = segment.map.timescales || {};
          segment.map.timescales[track.id] = track.timescale;
        }
      });
      return _callback(null);
    }
  });
};
/**
 * Handle init-segment responses
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */


var handleInitSegmentResponse = function handleInitSegmentResponse(_ref2) {
  var segment = _ref2.segment,
      finishProcessingFn = _ref2.finishProcessingFn;
  return function (error, request) {
    var errorObj = handleErrors(error, request);

    if (errorObj) {
      return finishProcessingFn(errorObj, segment);
    }

    var bytes = new Uint8Array(request.response); // init segment is encypted, we will have to wait
    // until the key request is done to decrypt.

    if (segment.map.key) {
      segment.map.encryptedBytes = bytes;
      return finishProcessingFn(null, segment);
    }

    segment.map.bytes = bytes;
    parseInitSegment(segment, function (parseError) {
      if (parseError) {
        parseError.xhr = request;
        parseError.status = request.status;
        return finishProcessingFn(parseError, segment);
      }

      finishProcessingFn(null, segment);
    });
  };
};
/**
 * Response handler for segment-requests being sure to set the correct
 * property depending on whether the segment is encryped or not
 * Also records and keeps track of stats that are used for ABR purposes
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */


var handleSegmentResponse = function handleSegmentResponse(_ref3) {
  var segment = _ref3.segment,
      finishProcessingFn = _ref3.finishProcessingFn,
      responseType = _ref3.responseType;
  return function (error, request) {
    var errorObj = handleErrors(error, request);

    if (errorObj) {
      return finishProcessingFn(errorObj, segment);
    }

    var newBytes = // although responseText "should" exist, this guard serves to prevent an error being
    // thrown for two primary cases:
    // 1. the mime type override stops working, or is not implemented for a specific
    //    browser
    // 2. when using mock XHR libraries like sinon that do not allow the override behavior
    responseType === 'arraybuffer' || !request.responseText ? request.response : stringToArrayBuffer(request.responseText.substring(segment.lastReachedChar || 0));
    segment.stats = getRequestStats(request);

    if (segment.key) {
      segment.encryptedBytes = new Uint8Array(newBytes);
    } else {
      segment.bytes = new Uint8Array(newBytes);
    }

    return finishProcessingFn(null, segment);
  };
};

var transmuxAndNotify = function transmuxAndNotify(_ref4) {
  var segment = _ref4.segment,
      bytes = _ref4.bytes,
      trackInfoFn = _ref4.trackInfoFn,
      timingInfoFn = _ref4.timingInfoFn,
      videoSegmentTimingInfoFn = _ref4.videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn = _ref4.audioSegmentTimingInfoFn,
      id3Fn = _ref4.id3Fn,
      captionsFn = _ref4.captionsFn,
      isEndOfTimeline = _ref4.isEndOfTimeline,
      endedTimelineFn = _ref4.endedTimelineFn,
      dataFn = _ref4.dataFn,
      doneFn = _ref4.doneFn,
      onTransmuxerLog = _ref4.onTransmuxerLog;
  var fmp4Tracks = segment.map && segment.map.tracks || {};
  var isMuxed = Boolean(fmp4Tracks.audio && fmp4Tracks.video); // Keep references to each function so we can null them out after we're done with them.
  // One reason for this is that in the case of full segments, we want to trust start
  // times from the probe, rather than the transmuxer.

  var audioStartFn = timingInfoFn.bind(null, segment, 'audio', 'start');
  var audioEndFn = timingInfoFn.bind(null, segment, 'audio', 'end');
  var videoStartFn = timingInfoFn.bind(null, segment, 'video', 'start');
  var videoEndFn = timingInfoFn.bind(null, segment, 'video', 'end');

  var finish = function finish() {
    return transmux({
      bytes: bytes,
      transmuxer: segment.transmuxer,
      audioAppendStart: segment.audioAppendStart,
      gopsToAlignWith: segment.gopsToAlignWith,
      remux: isMuxed,
      onData: function onData(result) {
        result.type = result.type === 'combined' ? 'video' : result.type;
        dataFn(segment, result);
      },
      onTrackInfo: function onTrackInfo(trackInfo) {
        if (trackInfoFn) {
          if (isMuxed) {
            trackInfo.isMuxed = true;
          }

          trackInfoFn(segment, trackInfo);
        }
      },
      onAudioTimingInfo: function onAudioTimingInfo(audioTimingInfo) {
        // we only want the first start value we encounter
        if (audioStartFn && typeof audioTimingInfo.start !== 'undefined') {
          audioStartFn(audioTimingInfo.start);
          audioStartFn = null;
        } // we want to continually update the end time


        if (audioEndFn && typeof audioTimingInfo.end !== 'undefined') {
          audioEndFn(audioTimingInfo.end);
        }
      },
      onVideoTimingInfo: function onVideoTimingInfo(videoTimingInfo) {
        // we only want the first start value we encounter
        if (videoStartFn && typeof videoTimingInfo.start !== 'undefined') {
          videoStartFn(videoTimingInfo.start);
          videoStartFn = null;
        } // we want to continually update the end time


        if (videoEndFn && typeof videoTimingInfo.end !== 'undefined') {
          videoEndFn(videoTimingInfo.end);
        }
      },
      onVideoSegmentTimingInfo: function onVideoSegmentTimingInfo(videoSegmentTimingInfo) {
        videoSegmentTimingInfoFn(videoSegmentTimingInfo);
      },
      onAudioSegmentTimingInfo: function onAudioSegmentTimingInfo(audioSegmentTimingInfo) {
        audioSegmentTimingInfoFn(audioSegmentTimingInfo);
      },
      onId3: function onId3(id3Frames, dispatchType) {
        id3Fn(segment, id3Frames, dispatchType);
      },
      onCaptions: function onCaptions(captions) {
        captionsFn(segment, [captions]);
      },
      isEndOfTimeline: isEndOfTimeline,
      onEndedTimeline: function onEndedTimeline() {
        endedTimelineFn();
      },
      onTransmuxerLog: onTransmuxerLog,
      onDone: function onDone(result) {
        if (!doneFn) {
          return;
        }

        result.type = result.type === 'combined' ? 'video' : result.type;
        doneFn(null, segment, result);
      }
    });
  }; // In the transmuxer, we don't yet have the ability to extract a "proper" start time.
  // Meaning cached frame data may corrupt our notion of where this segment
  // really starts. To get around this, probe for the info needed.


  workerCallback({
    action: 'probeTs',
    transmuxer: segment.transmuxer,
    data: bytes,
    baseStartTime: segment.baseStartTime,
    callback: function callback(data) {
      segment.bytes = bytes = data.data;
      var probeResult = data.result;

      if (probeResult) {
        trackInfoFn(segment, {
          hasAudio: probeResult.hasAudio,
          hasVideo: probeResult.hasVideo,
          isMuxed: isMuxed
        });
        trackInfoFn = null;
      }

      finish();
    }
  });
};

var handleSegmentBytes = function handleSegmentBytes(_ref5) {
  var segment = _ref5.segment,
      bytes = _ref5.bytes,
      trackInfoFn = _ref5.trackInfoFn,
      timingInfoFn = _ref5.timingInfoFn,
      videoSegmentTimingInfoFn = _ref5.videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn = _ref5.audioSegmentTimingInfoFn,
      id3Fn = _ref5.id3Fn,
      captionsFn = _ref5.captionsFn,
      isEndOfTimeline = _ref5.isEndOfTimeline,
      endedTimelineFn = _ref5.endedTimelineFn,
      dataFn = _ref5.dataFn,
      doneFn = _ref5.doneFn,
      onTransmuxerLog = _ref5.onTransmuxerLog;
  var bytesAsUint8Array = new Uint8Array(bytes); // TODO:
  // We should have a handler that fetches the number of bytes required
  // to check if something is fmp4. This will allow us to save bandwidth
  // because we can only exclude a playlist and abort requests
  // by codec after trackinfo triggers.

  if (isLikelyFmp4MediaSegment(bytesAsUint8Array)) {
    segment.isFmp4 = true;
    var tracks = segment.map.tracks;
    var trackInfo = {
      isFmp4: true,
      hasVideo: !!tracks.video,
      hasAudio: !!tracks.audio
    }; // if we have a audio track, with a codec that is not set to
    // encrypted audio

    if (tracks.audio && tracks.audio.codec && tracks.audio.codec !== 'enca') {
      trackInfo.audioCodec = tracks.audio.codec;
    } // if we have a video track, with a codec that is not set to
    // encrypted video


    if (tracks.video && tracks.video.codec && tracks.video.codec !== 'encv') {
      trackInfo.videoCodec = tracks.video.codec;
    }

    if (tracks.video && tracks.audio) {
      trackInfo.isMuxed = true;
    } // since we don't support appending fmp4 data on progress, we know we have the full
    // segment here


    trackInfoFn(segment, trackInfo); // The probe doesn't provide the segment end time, so only callback with the start
    // time. The end time can be roughly calculated by the receiver using the duration.
    //
    // Note that the start time returned by the probe reflects the baseMediaDecodeTime, as
    // that is the true start of the segment (where the playback engine should begin
    // decoding).

    var finishLoading = function finishLoading(captions, id3Frames) {
      // if the track still has audio at this point it is only possible
      // for it to be audio only. See `tracks.video && tracks.audio` if statement
      // above.
      // we make sure to use segment.bytes here as that
      dataFn(segment, {
        data: bytesAsUint8Array,
        type: trackInfo.hasAudio && !trackInfo.isMuxed ? 'audio' : 'video'
      });

      if (id3Frames && id3Frames.length) {
        id3Fn(segment, id3Frames);
      }

      if (captions && captions.length) {
        captionsFn(segment, captions);
      }

      doneFn(null, segment, {});
    };

    workerCallback({
      action: 'probeMp4StartTime',
      timescales: segment.map.timescales,
      data: bytesAsUint8Array,
      transmuxer: segment.transmuxer,
      callback: function callback(_ref6) {
        var data = _ref6.data,
            startTime = _ref6.startTime;
        // transfer bytes back to us
        bytes = data.buffer;
        segment.bytes = bytesAsUint8Array = data;

        if (trackInfo.hasAudio && !trackInfo.isMuxed) {
          timingInfoFn(segment, 'audio', 'start', startTime);
        }

        if (trackInfo.hasVideo) {
          timingInfoFn(segment, 'video', 'start', startTime);
        }

        workerCallback({
          action: 'probeEmsgID3',
          data: bytesAsUint8Array,
          transmuxer: segment.transmuxer,
          offset: startTime,
          callback: function callback(_ref7) {
            var emsgData = _ref7.emsgData,
                id3Frames = _ref7.id3Frames;
            // transfer bytes back to us
            bytes = emsgData.buffer;
            segment.bytes = bytesAsUint8Array = emsgData; // Run through the CaptionParser in case there are captions.
            // Initialize CaptionParser if it hasn't been yet

            if (!tracks.video || !emsgData.byteLength || !segment.transmuxer) {
              finishLoading(undefined, id3Frames);
              return;
            }

            workerCallback({
              action: 'pushMp4Captions',
              endAction: 'mp4Captions',
              transmuxer: segment.transmuxer,
              data: bytesAsUint8Array,
              timescales: segment.map.timescales,
              trackIds: [tracks.video.id],
              callback: function callback(message) {
                // transfer bytes back to us
                bytes = message.data.buffer;
                segment.bytes = bytesAsUint8Array = message.data;
                message.logs.forEach(function (log) {
                  onTransmuxerLog(merge(log, {
                    stream: 'mp4CaptionParser'
                  }));
                });
                finishLoading(message.captions, id3Frames);
              }
            });
          }
        });
      }
    });
    return;
  } // VTT or other segments that don't need processing


  if (!segment.transmuxer) {
    doneFn(null, segment, {});
    return;
  }

  if (typeof segment.container === 'undefined') {
    segment.container = detectContainerForBytes(bytesAsUint8Array);
  }

  if (segment.container !== 'ts' && segment.container !== 'aac') {
    trackInfoFn(segment, {
      hasAudio: false,
      hasVideo: false
    });
    doneFn(null, segment, {});
    return;
  } // ts or aac


  transmuxAndNotify({
    segment: segment,
    bytes: bytes,
    trackInfoFn: trackInfoFn,
    timingInfoFn: timingInfoFn,
    videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
    audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
    id3Fn: id3Fn,
    captionsFn: captionsFn,
    isEndOfTimeline: isEndOfTimeline,
    endedTimelineFn: endedTimelineFn,
    dataFn: dataFn,
    doneFn: doneFn,
    onTransmuxerLog: onTransmuxerLog
  });
};

var decrypt = function decrypt(_ref8, callback) {
  var id = _ref8.id,
      key = _ref8.key,
      encryptedBytes = _ref8.encryptedBytes,
      decryptionWorker = _ref8.decryptionWorker;

  var decryptionHandler = function decryptionHandler(event) {
    if (event.data.source === id) {
      decryptionWorker.removeEventListener('message', decryptionHandler);
      var decrypted = event.data.decrypted;
      callback(new Uint8Array(decrypted.bytes, decrypted.byteOffset, decrypted.byteLength));
    }
  };

  decryptionWorker.addEventListener('message', decryptionHandler);
  var keyBytes;

  if (key.bytes.slice) {
    keyBytes = key.bytes.slice();
  } else {
    keyBytes = new Uint32Array(Array.prototype.slice.call(key.bytes));
  } // incrementally decrypt the bytes


  decryptionWorker.postMessage(createTransferableMessage({
    source: id,
    encrypted: encryptedBytes,
    key: keyBytes,
    iv: key.iv
  }), [encryptedBytes.buffer, keyBytes.buffer]);
};
/**
 * Decrypt the segment via the decryption web worker
 *
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128 decryption
 *                                       routines
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} timingInfoFn - a callback that receives timing info
 * @param {Function} videoSegmentTimingInfoFn
 *                   a callback that receives video timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} audioSegmentTimingInfoFn
 *                   a callback that receives audio timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {boolean}  isEndOfTimeline
 *                   true if this segment represents the last segment in a timeline
 * @param {Function} endedTimelineFn
 *                   a callback made when a timeline is ended, will only be called if
 *                   isEndOfTimeline is true
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Function} doneFn - a callback that is executed after decryption has completed
 */


var decryptSegment = function decryptSegment(_ref9) {
  var decryptionWorker = _ref9.decryptionWorker,
      segment = _ref9.segment,
      trackInfoFn = _ref9.trackInfoFn,
      timingInfoFn = _ref9.timingInfoFn,
      videoSegmentTimingInfoFn = _ref9.videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn = _ref9.audioSegmentTimingInfoFn,
      id3Fn = _ref9.id3Fn,
      captionsFn = _ref9.captionsFn,
      isEndOfTimeline = _ref9.isEndOfTimeline,
      endedTimelineFn = _ref9.endedTimelineFn,
      dataFn = _ref9.dataFn,
      doneFn = _ref9.doneFn,
      onTransmuxerLog = _ref9.onTransmuxerLog;
  decrypt({
    id: segment.requestId,
    key: segment.key,
    encryptedBytes: segment.encryptedBytes,
    decryptionWorker: decryptionWorker
  }, function (decryptedBytes) {
    segment.bytes = decryptedBytes;
    handleSegmentBytes({
      segment: segment,
      bytes: segment.bytes,
      trackInfoFn: trackInfoFn,
      timingInfoFn: timingInfoFn,
      videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
      id3Fn: id3Fn,
      captionsFn: captionsFn,
      isEndOfTimeline: isEndOfTimeline,
      endedTimelineFn: endedTimelineFn,
      dataFn: dataFn,
      doneFn: doneFn,
      onTransmuxerLog: onTransmuxerLog
    });
  });
};
/**
 * This function waits for all XHRs to finish (with either success or failure)
 * before continueing processing via it's callback. The function gathers errors
 * from each request into a single errors array so that the error status for
 * each request can be examined later.
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128 decryption
 *                                       routines
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} timingInfoFn - a callback that receives timing info
 * @param {Function} videoSegmentTimingInfoFn
 *                   a callback that receives video timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} audioSegmentTimingInfoFn
 *                   a callback that receives audio timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} id3Fn - a callback that receives ID3 metadata
 * @param {Function} captionsFn - a callback that receives captions
 * @param {boolean}  isEndOfTimeline
 *                   true if this segment represents the last segment in a timeline
 * @param {Function} endedTimelineFn
 *                   a callback made when a timeline is ended, will only be called if
 *                   isEndOfTimeline is true
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Function} doneFn - a callback that is executed after all resources have been
 *                            downloaded and any decryption completed
 */


var waitForCompletion = function waitForCompletion(_ref10) {
  var activeXhrs = _ref10.activeXhrs,
      decryptionWorker = _ref10.decryptionWorker,
      trackInfoFn = _ref10.trackInfoFn,
      timingInfoFn = _ref10.timingInfoFn,
      videoSegmentTimingInfoFn = _ref10.videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn = _ref10.audioSegmentTimingInfoFn,
      id3Fn = _ref10.id3Fn,
      captionsFn = _ref10.captionsFn,
      isEndOfTimeline = _ref10.isEndOfTimeline,
      endedTimelineFn = _ref10.endedTimelineFn,
      dataFn = _ref10.dataFn,
      doneFn = _ref10.doneFn,
      onTransmuxerLog = _ref10.onTransmuxerLog;
  var count = 0;
  var didError = false;
  return function (error, segment) {
    if (didError) {
      return;
    }

    if (error) {
      didError = true; // If there are errors, we have to abort any outstanding requests

      abortAll(activeXhrs); // Even though the requests above are aborted, and in theory we could wait until we
      // handle the aborted events from those requests, there are some cases where we may
      // never get an aborted event. For instance, if the network connection is lost and
      // there were two requests, the first may have triggered an error immediately, while
      // the second request remains unsent. In that case, the aborted algorithm will not
      // trigger an abort: see https://xhr.spec.whatwg.org/#the-abort()-method
      //
      // We also can't rely on the ready state of the XHR, since the request that
      // triggered the connection error may also show as a ready state of 0 (unsent).
      // Therefore, we have to finish this group of requests immediately after the first
      // seen error.

      return doneFn(error, segment);
    }

    count += 1;

    if (count === activeXhrs.length) {
      var segmentFinish = function segmentFinish() {
        if (segment.encryptedBytes) {
          return decryptSegment({
            decryptionWorker: decryptionWorker,
            segment: segment,
            trackInfoFn: trackInfoFn,
            timingInfoFn: timingInfoFn,
            videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
            audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
            id3Fn: id3Fn,
            captionsFn: captionsFn,
            isEndOfTimeline: isEndOfTimeline,
            endedTimelineFn: endedTimelineFn,
            dataFn: dataFn,
            doneFn: doneFn,
            onTransmuxerLog: onTransmuxerLog
          });
        } // Otherwise, everything is ready just continue


        handleSegmentBytes({
          segment: segment,
          bytes: segment.bytes,
          trackInfoFn: trackInfoFn,
          timingInfoFn: timingInfoFn,
          videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
          audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
          id3Fn: id3Fn,
          captionsFn: captionsFn,
          isEndOfTimeline: isEndOfTimeline,
          endedTimelineFn: endedTimelineFn,
          dataFn: dataFn,
          doneFn: doneFn,
          onTransmuxerLog: onTransmuxerLog
        });
      }; // Keep track of when *all* of the requests have completed


      segment.endOfAllRequests = Date.now();

      if (segment.map && segment.map.encryptedBytes && !segment.map.bytes) {
        return decrypt({
          decryptionWorker: decryptionWorker,
          // add -init to the "id" to differentiate between segment
          // and init segment decryption, just in case they happen
          // at the same time at some point in the future.
          id: segment.requestId + '-init',
          encryptedBytes: segment.map.encryptedBytes,
          key: segment.map.key
        }, function (decryptedBytes) {
          segment.map.bytes = decryptedBytes;
          parseInitSegment(segment, function (parseError) {
            if (parseError) {
              abortAll(activeXhrs);
              return doneFn(parseError, segment);
            }

            segmentFinish();
          });
        });
      }

      segmentFinish();
    }
  };
};
/**
 * Calls the abort callback if any request within the batch was aborted. Will only call
 * the callback once per batch of requests, even if multiple were aborted.
 *
 * @param {Object} loadendState - state to check to see if the abort function was called
 * @param {Function} abortFn - callback to call for abort
 */


var handleLoadEnd = function handleLoadEnd(_ref11) {
  var loadendState = _ref11.loadendState,
      abortFn = _ref11.abortFn;
  return function (event) {
    var request = event.target;

    if (request.aborted && abortFn && !loadendState.calledAbortFn) {
      abortFn();
      loadendState.calledAbortFn = true;
    }
  };
};
/**
 * Simple progress event callback handler that gathers some stats before
 * executing a provided callback with the `segment` object
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} progressFn - a callback that is executed each time a progress event
 *                                is received
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} timingInfoFn - a callback that receives timing info
 * @param {Function} videoSegmentTimingInfoFn
 *                   a callback that receives video timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} audioSegmentTimingInfoFn
 *                   a callback that receives audio timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {boolean}  isEndOfTimeline
 *                   true if this segment represents the last segment in a timeline
 * @param {Function} endedTimelineFn
 *                   a callback made when a timeline is ended, will only be called if
 *                   isEndOfTimeline is true
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Event} event - the progress event object from XMLHttpRequest
 */


var handleProgress = function handleProgress(_ref12) {
  var segment = _ref12.segment,
      progressFn = _ref12.progressFn;
      _ref12.trackInfoFn;
      _ref12.timingInfoFn;
      _ref12.videoSegmentTimingInfoFn;
      _ref12.audioSegmentTimingInfoFn;
      _ref12.id3Fn;
      _ref12.captionsFn;
      _ref12.isEndOfTimeline;
      _ref12.endedTimelineFn;
      _ref12.dataFn;
  return function (event) {
    var request = event.target;

    if (request.aborted) {
      return;
    }

    segment.stats = merge(segment.stats, getProgressStats(event)); // record the time that we receive the first byte of data

    if (!segment.stats.firstBytesReceivedAt && segment.stats.bytesReceived) {
      segment.stats.firstBytesReceivedAt = Date.now();
    }

    return progressFn(event, segment);
  };
};
/**
 * Load all resources and does any processing necessary for a media-segment
 *
 * Features:
 *   decrypts the media-segment if it has a key uri and an iv
 *   aborts *all* requests if *any* one request fails
 *
 * The segment object, at minimum, has the following format:
 * {
 *   resolvedUri: String,
 *   [transmuxer]: Object,
 *   [byterange]: {
 *     offset: Number,
 *     length: Number
 *   },
 *   [key]: {
 *     resolvedUri: String
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     iv: {
 *       bytes: Uint32Array
 *     }
 *   },
 *   [map]: {
 *     resolvedUri: String,
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     [bytes]: Uint8Array
 *   }
 * }
 * ...where [name] denotes optional properties
 *
 * @param {Function} xhr - an instance of the xhr wrapper in xhr.js
 * @param {Object} xhrOptions - the base options to provide to all xhr requests
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128
 *                                       decryption routines
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} abortFn - a callback called (only once) if any piece of a request was
 *                             aborted
 * @param {Function} progressFn - a callback that receives progress events from the main
 *                                segment's xhr request
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} timingInfoFn - a callback that receives timing info
 * @param {Function} videoSegmentTimingInfoFn
 *                   a callback that receives video timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} audioSegmentTimingInfoFn
 *                   a callback that receives audio timing info based on media times and
 *                   any adjustments made by the transmuxer
 * @param {Function} id3Fn - a callback that receives ID3 metadata
 * @param {Function} captionsFn - a callback that receives captions
 * @param {boolean}  isEndOfTimeline
 *                   true if this segment represents the last segment in a timeline
 * @param {Function} endedTimelineFn
 *                   a callback made when a timeline is ended, will only be called if
 *                   isEndOfTimeline is true
 * @param {Function} dataFn - a callback that receives data from the main segment's xhr
 *                            request, transmuxed if needed
 * @param {Function} doneFn - a callback that is executed only once all requests have
 *                            succeeded or failed
 * @return {Function} a function that, when invoked, immediately aborts all
 *                     outstanding requests
 */


var mediaSegmentRequest = function mediaSegmentRequest(_ref13) {
  var xhr = _ref13.xhr,
      xhrOptions = _ref13.xhrOptions,
      decryptionWorker = _ref13.decryptionWorker,
      segment = _ref13.segment,
      abortFn = _ref13.abortFn,
      progressFn = _ref13.progressFn,
      trackInfoFn = _ref13.trackInfoFn,
      timingInfoFn = _ref13.timingInfoFn,
      videoSegmentTimingInfoFn = _ref13.videoSegmentTimingInfoFn,
      audioSegmentTimingInfoFn = _ref13.audioSegmentTimingInfoFn,
      id3Fn = _ref13.id3Fn,
      captionsFn = _ref13.captionsFn,
      isEndOfTimeline = _ref13.isEndOfTimeline,
      endedTimelineFn = _ref13.endedTimelineFn,
      dataFn = _ref13.dataFn,
      doneFn = _ref13.doneFn,
      onTransmuxerLog = _ref13.onTransmuxerLog;
  var activeXhrs = [];
  var finishProcessingFn = waitForCompletion({
    activeXhrs: activeXhrs,
    decryptionWorker: decryptionWorker,
    trackInfoFn: trackInfoFn,
    timingInfoFn: timingInfoFn,
    videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
    audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
    id3Fn: id3Fn,
    captionsFn: captionsFn,
    isEndOfTimeline: isEndOfTimeline,
    endedTimelineFn: endedTimelineFn,
    dataFn: dataFn,
    doneFn: doneFn,
    onTransmuxerLog: onTransmuxerLog
  }); // optionally, request the decryption key

  if (segment.key && !segment.key.bytes) {
    var objects = [segment.key];

    if (segment.map && !segment.map.bytes && segment.map.key && segment.map.key.resolvedUri === segment.key.resolvedUri) {
      objects.push(segment.map.key);
    }

    var keyRequestOptions = merge(xhrOptions, {
      uri: segment.key.resolvedUri,
      responseType: 'arraybuffer',
      requestType: 'segment-key'
    });
    var keyRequestCallback = handleKeyResponse(segment, objects, finishProcessingFn);
    var keyXhr = xhr(keyRequestOptions, keyRequestCallback);
    activeXhrs.push(keyXhr);
  } // optionally, request the associated media init segment


  if (segment.map && !segment.map.bytes) {
    var differentMapKey = segment.map.key && (!segment.key || segment.key.resolvedUri !== segment.map.key.resolvedUri);

    if (differentMapKey) {
      var mapKeyRequestOptions = merge(xhrOptions, {
        uri: segment.map.key.resolvedUri,
        responseType: 'arraybuffer',
        requestType: 'segment-key'
      });
      var mapKeyRequestCallback = handleKeyResponse(segment, [segment.map.key], finishProcessingFn);
      var mapKeyXhr = xhr(mapKeyRequestOptions, mapKeyRequestCallback);
      activeXhrs.push(mapKeyXhr);
    }

    var initSegmentOptions = merge(xhrOptions, {
      uri: segment.map.resolvedUri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segment.map),
      requestType: 'segment-media-initialization'
    });
    var initSegmentRequestCallback = handleInitSegmentResponse({
      segment: segment,
      finishProcessingFn: finishProcessingFn
    });
    var initSegmentXhr = xhr(initSegmentOptions, initSegmentRequestCallback);
    activeXhrs.push(initSegmentXhr);
  }

  var segmentRequestOptions = merge(xhrOptions, {
    uri: segment.part && segment.part.resolvedUri || segment.resolvedUri,
    responseType: 'arraybuffer',
    headers: segmentXhrHeaders(segment),
    requestType: 'segment'
  });
  var segmentRequestCallback = handleSegmentResponse({
    segment: segment,
    finishProcessingFn: finishProcessingFn,
    responseType: segmentRequestOptions.responseType
  });
  var segmentXhr = xhr(segmentRequestOptions, segmentRequestCallback);
  segmentXhr.addEventListener('progress', handleProgress({
    segment: segment,
    progressFn: progressFn,
    trackInfoFn: trackInfoFn,
    timingInfoFn: timingInfoFn,
    videoSegmentTimingInfoFn: videoSegmentTimingInfoFn,
    audioSegmentTimingInfoFn: audioSegmentTimingInfoFn,
    id3Fn: id3Fn,
    captionsFn: captionsFn,
    isEndOfTimeline: isEndOfTimeline,
    endedTimelineFn: endedTimelineFn,
    dataFn: dataFn
  }));
  activeXhrs.push(segmentXhr); // since all parts of the request must be considered, but should not make callbacks
  // multiple times, provide a shared state object

  var loadendState = {};
  activeXhrs.forEach(function (activeXhr) {
    activeXhr.addEventListener('loadend', handleLoadEnd({
      loadendState: loadendState,
      abortFn: abortFn
    }));
  });
  return function () {
    return abortAll(activeXhrs);
  };
};

/**
 * @file - codecs.js - Handles tasks regarding codec strings such as translating them to
 * codec strings, or translating codec strings into objects that can be examined.
 */
var logFn$1 = logger('CodecUtils');
/**
 * Returns a set of codec strings parsed from the playlist or the default
 * codec strings if no codecs were specified in the playlist
 *
 * @param {Playlist} media the current media playlist
 * @return {Object} an object with the video and audio codecs
 */

var getCodecs = function getCodecs(media) {
  // if the codecs were explicitly specified, use them instead of the
  // defaults
  var mediaAttributes = media.attributes || {};

  if (mediaAttributes.CODECS) {
    return parseCodecs(mediaAttributes.CODECS);
  }
};

var isMaat = function isMaat(main, media) {
  var mediaAttributes = media.attributes || {};
  return main && main.mediaGroups && main.mediaGroups.AUDIO && mediaAttributes.AUDIO && main.mediaGroups.AUDIO[mediaAttributes.AUDIO];
};
var isMuxed = function isMuxed(main, media) {
  if (!isMaat(main, media)) {
    return true;
  }

  var mediaAttributes = media.attributes || {};
  var audioGroup = main.mediaGroups.AUDIO[mediaAttributes.AUDIO];

  for (var groupId in audioGroup) {
    // If an audio group has a URI (the case for HLS, as HLS will use external playlists),
    // or there are listed playlists (the case for DASH, as the manifest will have already
    // provided all of the details necessary to generate the audio playlist, as opposed to
    // HLS' externally requested playlists), then the content is demuxed.
    if (!audioGroup[groupId].uri && !audioGroup[groupId].playlists) {
      return true;
    }
  }

  return false;
};
var unwrapCodecList = function unwrapCodecList(codecList) {
  var codecs = {};
  codecList.forEach(function (_ref) {
    var mediaType = _ref.mediaType,
        type = _ref.type,
        details = _ref.details;
    codecs[mediaType] = codecs[mediaType] || [];
    codecs[mediaType].push(translateLegacyCodec("" + type + details));
  });
  Object.keys(codecs).forEach(function (mediaType) {
    if (codecs[mediaType].length > 1) {
      logFn$1("multiple " + mediaType + " codecs found as attributes: " + codecs[mediaType].join(', ') + ". Setting playlist codecs to null so that we wait for mux.js to probe segments for real codecs.");
      codecs[mediaType] = null;
      return;
    }

    codecs[mediaType] = codecs[mediaType][0];
  });
  return codecs;
};
var codecCount = function codecCount(codecObj) {
  var count = 0;

  if (codecObj.audio) {
    count++;
  }

  if (codecObj.video) {
    count++;
  }

  return count;
};
/**
 * Calculates the codec strings for a working configuration of
 * SourceBuffers to play variant streams in a main playlist. If
 * there is no possible working configuration, an empty object will be
 * returned.
 *
 * @param main {Object} the m3u8 object for the main playlist
 * @param media {Object} the m3u8 object for the variant playlist
 * @return {Object} the codec strings.
 *
 * @private
 */

var codecsForPlaylist = function codecsForPlaylist(main, media) {
  var mediaAttributes = media.attributes || {};
  var codecInfo = unwrapCodecList(getCodecs(media) || []); // HLS with multiple-audio tracks must always get an audio codec.
  // Put another way, there is no way to have a video-only multiple-audio HLS!

  if (isMaat(main, media) && !codecInfo.audio) {
    if (!isMuxed(main, media)) {
      // It is possible for codecs to be specified on the audio media group playlist but
      // not on the rendition playlist. This is mostly the case for DASH, where audio and
      // video are always separate (and separately specified).
      var defaultCodecs = unwrapCodecList(codecsFromDefault(main, mediaAttributes.AUDIO) || []);

      if (defaultCodecs.audio) {
        codecInfo.audio = defaultCodecs.audio;
      }
    }
  }

  return codecInfo;
};

var logFn = logger('PlaylistSelector');

var representationToString = function representationToString(representation) {
  if (!representation || !representation.playlist) {
    return;
  }

  var playlist = representation.playlist;
  return JSON.stringify({
    id: playlist.id,
    bandwidth: representation.bandwidth,
    width: representation.width,
    height: representation.height,
    codecs: playlist.attributes && playlist.attributes.CODECS || ''
  });
}; // Utilities

/**
 * Returns the CSS value for the specified property on an element
 * using `getComputedStyle`. Firefox has a long-standing issue where
 * getComputedStyle() may return null when running in an iframe with
 * `display: none`.
 *
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=548397
 * @param {HTMLElement} el the htmlelement to work on
 * @param {string} the proprety to get the style for
 */


var safeGetComputedStyle = function safeGetComputedStyle(el, property) {
  if (!el) {
    return '';
  }

  var result = window$1.getComputedStyle(el);

  if (!result) {
    return '';
  }

  return result[property];
};
/**
 * Resuable stable sort function
 *
 * @param {Playlists} array
 * @param {Function} sortFn Different comparators
 * @function stableSort
 */


var stableSort = function stableSort(array, sortFn) {
  var newArray = array.slice();
  array.sort(function (left, right) {
    var cmp = sortFn(left, right);

    if (cmp === 0) {
      return newArray.indexOf(left) - newArray.indexOf(right);
    }

    return cmp;
  });
};
/**
 * A comparator function to sort two playlist object by bandwidth.
 *
 * @param {Object} left a media playlist object
 * @param {Object} right a media playlist object
 * @return {number} Greater than zero if the bandwidth attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the bandwidth of right is greater than left and
 * exactly zero if the two are equal.
 */


var comparePlaylistBandwidth = function comparePlaylistBandwidth(left, right) {
  var leftBandwidth;
  var rightBandwidth;

  if (left.attributes.BANDWIDTH) {
    leftBandwidth = left.attributes.BANDWIDTH;
  }

  leftBandwidth = leftBandwidth || window$1.Number.MAX_VALUE;

  if (right.attributes.BANDWIDTH) {
    rightBandwidth = right.attributes.BANDWIDTH;
  }

  rightBandwidth = rightBandwidth || window$1.Number.MAX_VALUE;
  return leftBandwidth - rightBandwidth;
};
/**
 * A comparator function to sort two playlist object by resolution (width).
 *
 * @param {Object} left a media playlist object
 * @param {Object} right a media playlist object
 * @return {number} Greater than zero if the resolution.width attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the resolution.width of right is greater than left and
 * exactly zero if the two are equal.
 */

var comparePlaylistResolution = function comparePlaylistResolution(left, right) {
  var leftWidth;
  var rightWidth;

  if (left.attributes.RESOLUTION && left.attributes.RESOLUTION.width) {
    leftWidth = left.attributes.RESOLUTION.width;
  }

  leftWidth = leftWidth || window$1.Number.MAX_VALUE;

  if (right.attributes.RESOLUTION && right.attributes.RESOLUTION.width) {
    rightWidth = right.attributes.RESOLUTION.width;
  }

  rightWidth = rightWidth || window$1.Number.MAX_VALUE; // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
  // have the same media dimensions/ resolution

  if (leftWidth === rightWidth && left.attributes.BANDWIDTH && right.attributes.BANDWIDTH) {
    return left.attributes.BANDWIDTH - right.attributes.BANDWIDTH;
  }

  return leftWidth - rightWidth;
};
/**
 * Chooses the appropriate media playlist based on bandwidth and player size
 *
 * @param {Object} main
 *        Object representation of the main manifest
 * @param {number} playerBandwidth
 *        Current calculated bandwidth of the player
 * @param {number} playerWidth
 *        Current width of the player element (should account for the device pixel ratio)
 * @param {number} playerHeight
 *        Current height of the player element (should account for the device pixel ratio)
 * @param {boolean} limitRenditionByPlayerDimensions
 *        True if the player width and height should be used during the selection, false otherwise
 * @param {Object} playlistController
 *        the current playlistController object
 * @return {Playlist} the highest bitrate playlist less than the
 * currently detected bandwidth, accounting for some amount of
 * bandwidth variance
 */

var simpleSelector = function simpleSelector(main, playerBandwidth, playerWidth, playerHeight, limitRenditionByPlayerDimensions, playlistController) {
  // If we end up getting called before `main` is available, exit early
  if (!main) {
    return;
  }

  var options = {
    bandwidth: playerBandwidth,
    width: playerWidth,
    height: playerHeight,
    limitRenditionByPlayerDimensions: limitRenditionByPlayerDimensions
  };
  var playlists = main.playlists; // if playlist is audio only, select between currently active audio group playlists.

  if (Playlist.isAudioOnly(main)) {
    playlists = playlistController.getAudioTrackPlaylists_(); // add audioOnly to options so that we log audioOnly: true
    // at the buttom of this function for debugging.

    options.audioOnly = true;
  } // convert the playlists to an intermediary representation to make comparisons easier


  var sortedPlaylistReps = playlists.map(function (playlist) {
    var bandwidth;
    var width = playlist.attributes && playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.width;
    var height = playlist.attributes && playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.height;
    bandwidth = playlist.attributes && playlist.attributes.BANDWIDTH;
    bandwidth = bandwidth || window$1.Number.MAX_VALUE;
    return {
      bandwidth: bandwidth,
      width: width,
      height: height,
      playlist: playlist
    };
  });
  stableSort(sortedPlaylistReps, function (left, right) {
    return left.bandwidth - right.bandwidth;
  }); // filter out any playlists that have been excluded due to
  // incompatible configurations

  sortedPlaylistReps = sortedPlaylistReps.filter(function (rep) {
    return !Playlist.isIncompatible(rep.playlist);
  }); // filter out any playlists that have been disabled manually through the representations
  // api or excluded temporarily due to playback errors.

  var enabledPlaylistReps = sortedPlaylistReps.filter(function (rep) {
    return Playlist.isEnabled(rep.playlist);
  });

  if (!enabledPlaylistReps.length) {
    // if there are no enabled playlists, then they have all been excluded or disabled
    // by the user through the representations api. In this case, ignore exclusion and
    // fallback to what the user wants by using playlists the user has not disabled.
    enabledPlaylistReps = sortedPlaylistReps.filter(function (rep) {
      return !Playlist.isDisabled(rep.playlist);
    });
  } // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth


  var bandwidthPlaylistReps = enabledPlaylistReps.filter(function (rep) {
    return rep.bandwidth * Config.BANDWIDTH_VARIANCE < playerBandwidth;
  });
  var highestRemainingBandwidthRep = bandwidthPlaylistReps[bandwidthPlaylistReps.length - 1]; // get all of the renditions with the same (highest) bandwidth
  // and then taking the very first element

  var bandwidthBestRep = bandwidthPlaylistReps.filter(function (rep) {
    return rep.bandwidth === highestRemainingBandwidthRep.bandwidth;
  })[0]; // if we're not going to limit renditions by player size, make an early decision.

  if (limitRenditionByPlayerDimensions === false) {
    var _chosenRep = bandwidthBestRep || enabledPlaylistReps[0] || sortedPlaylistReps[0];

    if (_chosenRep && _chosenRep.playlist) {
      var type = 'sortedPlaylistReps';

      if (bandwidthBestRep) {
        type = 'bandwidthBestRep';
      }

      if (enabledPlaylistReps[0]) {
        type = 'enabledPlaylistReps';
      }

      logFn("choosing " + representationToString(_chosenRep) + " using " + type + " with options", options);
      return _chosenRep.playlist;
    }

    logFn('could not choose a playlist with options', options);
    return null;
  } // filter out playlists without resolution information


  var haveResolution = bandwidthPlaylistReps.filter(function (rep) {
    return rep.width && rep.height;
  }); // sort variants by resolution

  stableSort(haveResolution, function (left, right) {
    return left.width - right.width;
  }); // if we have the exact resolution as the player use it

  var resolutionBestRepList = haveResolution.filter(function (rep) {
    return rep.width === playerWidth && rep.height === playerHeight;
  });
  highestRemainingBandwidthRep = resolutionBestRepList[resolutionBestRepList.length - 1]; // ensure that we pick the highest bandwidth variant that have exact resolution

  var resolutionBestRep = resolutionBestRepList.filter(function (rep) {
    return rep.bandwidth === highestRemainingBandwidthRep.bandwidth;
  })[0];
  var resolutionPlusOneList;
  var resolutionPlusOneSmallest;
  var resolutionPlusOneRep; // find the smallest variant that is larger than the player
  // if there is no match of exact resolution

  if (!resolutionBestRep) {
    resolutionPlusOneList = haveResolution.filter(function (rep) {
      return rep.width > playerWidth || rep.height > playerHeight;
    }); // find all the variants have the same smallest resolution

    resolutionPlusOneSmallest = resolutionPlusOneList.filter(function (rep) {
      return rep.width === resolutionPlusOneList[0].width && rep.height === resolutionPlusOneList[0].height;
    }); // ensure that we also pick the highest bandwidth variant that
    // is just-larger-than the video player

    highestRemainingBandwidthRep = resolutionPlusOneSmallest[resolutionPlusOneSmallest.length - 1];
    resolutionPlusOneRep = resolutionPlusOneSmallest.filter(function (rep) {
      return rep.bandwidth === highestRemainingBandwidthRep.bandwidth;
    })[0];
  }

  var leastPixelDiffRep; // If this selector proves to be better than others,
  // resolutionPlusOneRep and resolutionBestRep and all
  // the code involving them should be removed.

  if (playlistController.leastPixelDiffSelector) {
    // find the variant that is closest to the player's pixel size
    var leastPixelDiffList = haveResolution.map(function (rep) {
      rep.pixelDiff = Math.abs(rep.width - playerWidth) + Math.abs(rep.height - playerHeight);
      return rep;
    }); // get the highest bandwidth, closest resolution playlist

    stableSort(leastPixelDiffList, function (left, right) {
      // sort by highest bandwidth if pixelDiff is the same
      if (left.pixelDiff === right.pixelDiff) {
        return right.bandwidth - left.bandwidth;
      }

      return left.pixelDiff - right.pixelDiff;
    });
    leastPixelDiffRep = leastPixelDiffList[0];
  } // fallback chain of variants


  var chosenRep = leastPixelDiffRep || resolutionPlusOneRep || resolutionBestRep || bandwidthBestRep || enabledPlaylistReps[0] || sortedPlaylistReps[0];

  if (chosenRep && chosenRep.playlist) {
    var _type = 'sortedPlaylistReps';

    if (leastPixelDiffRep) {
      _type = 'leastPixelDiffRep';
    } else if (resolutionPlusOneRep) {
      _type = 'resolutionPlusOneRep';
    } else if (resolutionBestRep) {
      _type = 'resolutionBestRep';
    } else if (bandwidthBestRep) {
      _type = 'bandwidthBestRep';
    } else if (enabledPlaylistReps[0]) {
      _type = 'enabledPlaylistReps';
    }

    logFn("choosing " + representationToString(chosenRep) + " using " + _type + " with options", options);
    return chosenRep.playlist;
  }

  logFn('could not choose a playlist with options', options);
  return null;
};

/**
 * Chooses the appropriate media playlist based on the most recent
 * bandwidth estimate and the player size.
 *
 * Expects to be called within the context of an instance of VhsHandler
 *
 * @return {Playlist} the highest bitrate playlist less than the
 * currently detected bandwidth, accounting for some amount of
 * bandwidth variance
 */

var lastBandwidthSelector = function lastBandwidthSelector() {
  var pixelRatio = this.useDevicePixelRatio ? window$1.devicePixelRatio || 1 : 1;

  if (!isNaN(this.customPixelRatio)) {
    pixelRatio = this.customPixelRatio;
  }

  return simpleSelector(this.playlists.main, this.systemBandwidth, parseInt(safeGetComputedStyle(this.tech_.el(), 'width'), 10) * pixelRatio, parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10) * pixelRatio, this.limitRenditionByPlayerDimensions, this.playlistController_);
};
/**
 * Chooses the appropriate media playlist based on an
 * exponential-weighted moving average of the bandwidth after
 * filtering for player size.
 *
 * Expects to be called within the context of an instance of VhsHandler
 *
 * @param {number} decay - a number between 0 and 1. Higher values of
 * this parameter will cause previous bandwidth estimates to lose
 * significance more quickly.
 * @return {Function} a function which can be invoked to create a new
 * playlist selector function.
 * @see https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average
 */

var movingAverageBandwidthSelector = function movingAverageBandwidthSelector(decay) {
  var average = -1;
  var lastSystemBandwidth = -1;

  if (decay < 0 || decay > 1) {
    throw new Error('Moving average bandwidth decay must be between 0 and 1.');
  }

  return function () {
    var pixelRatio = this.useDevicePixelRatio ? window$1.devicePixelRatio || 1 : 1;

    if (!isNaN(this.customPixelRatio)) {
      pixelRatio = this.customPixelRatio;
    }

    if (average < 0) {
      average = this.systemBandwidth;
      lastSystemBandwidth = this.systemBandwidth;
    } // stop the average value from decaying for every 250ms
    // when the systemBandwidth is constant
    // and
    // stop average from setting to a very low value when the
    // systemBandwidth becomes 0 in case of chunk cancellation


    if (this.systemBandwidth > 0 && this.systemBandwidth !== lastSystemBandwidth) {
      average = decay * this.systemBandwidth + (1 - decay) * average;
      lastSystemBandwidth = this.systemBandwidth;
    }

    return simpleSelector(this.playlists.main, average, parseInt(safeGetComputedStyle(this.tech_.el(), 'width'), 10) * pixelRatio, parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10) * pixelRatio, this.limitRenditionByPlayerDimensions, this.playlistController_);
  };
};
/**
 * Chooses the appropriate media playlist based on the potential to rebuffer
 *
 * @param {Object} settings
 *        Object of information required to use this selector
 * @param {Object} settings.main
 *        Object representation of the main manifest
 * @param {number} settings.currentTime
 *        The current time of the player
 * @param {number} settings.bandwidth
 *        Current measured bandwidth
 * @param {number} settings.duration
 *        Duration of the media
 * @param {number} settings.segmentDuration
 *        Segment duration to be used in round trip time calculations
 * @param {number} settings.timeUntilRebuffer
 *        Time left in seconds until the player has to rebuffer
 * @param {number} settings.currentTimeline
 *        The current timeline segments are being loaded from
 * @param {SyncController} settings.syncController
 *        SyncController for determining if we have a sync point for a given playlist
 * @return {Object|null}
 *         {Object} return.playlist
 *         The highest bandwidth playlist with the least amount of rebuffering
 *         {Number} return.rebufferingImpact
 *         The amount of time in seconds switching to this playlist will rebuffer. A
 *         negative value means that switching will cause zero rebuffering.
 */

var minRebufferMaxBandwidthSelector = function minRebufferMaxBandwidthSelector(settings) {
  var main = settings.main,
      currentTime = settings.currentTime,
      bandwidth = settings.bandwidth,
      duration = settings.duration,
      segmentDuration = settings.segmentDuration,
      timeUntilRebuffer = settings.timeUntilRebuffer,
      currentTimeline = settings.currentTimeline,
      syncController = settings.syncController; // filter out any playlists that have been excluded due to
  // incompatible configurations

  var compatiblePlaylists = main.playlists.filter(function (playlist) {
    return !Playlist.isIncompatible(playlist);
  }); // filter out any playlists that have been disabled manually through the representations
  // api or excluded temporarily due to playback errors.

  var enabledPlaylists = compatiblePlaylists.filter(Playlist.isEnabled);

  if (!enabledPlaylists.length) {
    // if there are no enabled playlists, then they have all been excluded or disabled
    // by the user through the representations api. In this case, ignore exclusion and
    // fallback to what the user wants by using playlists the user has not disabled.
    enabledPlaylists = compatiblePlaylists.filter(function (playlist) {
      return !Playlist.isDisabled(playlist);
    });
  }

  var bandwidthPlaylists = enabledPlaylists.filter(Playlist.hasAttribute.bind(null, 'BANDWIDTH'));
  var rebufferingEstimates = bandwidthPlaylists.map(function (playlist) {
    var syncPoint = syncController.getSyncPoint(playlist, duration, currentTimeline, currentTime); // If there is no sync point for this playlist, switching to it will require a
    // sync request first. This will double the request time

    var numRequests = syncPoint ? 1 : 2;
    var requestTimeEstimate = Playlist.estimateSegmentRequestTime(segmentDuration, bandwidth, playlist);
    var rebufferingImpact = requestTimeEstimate * numRequests - timeUntilRebuffer;
    return {
      playlist: playlist,
      rebufferingImpact: rebufferingImpact
    };
  });
  var noRebufferingPlaylists = rebufferingEstimates.filter(function (estimate) {
    return estimate.rebufferingImpact <= 0;
  }); // Sort by bandwidth DESC

  stableSort(noRebufferingPlaylists, function (a, b) {
    return comparePlaylistBandwidth(b.playlist, a.playlist);
  });

  if (noRebufferingPlaylists.length) {
    return noRebufferingPlaylists[0];
  }

  stableSort(rebufferingEstimates, function (a, b) {
    return a.rebufferingImpact - b.rebufferingImpact;
  });
  return rebufferingEstimates[0] || null;
};
/**
 * Chooses the appropriate media playlist, which in this case is the lowest bitrate
 * one with video.  If no renditions with video exist, return the lowest audio rendition.
 *
 * Expects to be called within the context of an instance of VhsHandler
 *
 * @return {Object|null}
 *         {Object} return.playlist
 *         The lowest bitrate playlist that contains a video codec.  If no such rendition
 *         exists pick the lowest audio rendition.
 */

var lowestBitrateCompatibleVariantSelector = function lowestBitrateCompatibleVariantSelector() {
  var _this = this;

  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  var playlists = this.playlists.main.playlists.filter(Playlist.isEnabled); // Sort ascending by bitrate

  stableSort(playlists, function (a, b) {
    return comparePlaylistBandwidth(a, b);
  }); // Parse and assume that playlists with no video codec have no video
  // (this is not necessarily true, although it is generally true).
  //
  // If an entire manifest has no valid videos everything will get filtered
  // out.

  var playlistsWithVideo = playlists.filter(function (playlist) {
    return !!codecsForPlaylist(_this.playlists.main, playlist).video;
  });
  return playlistsWithVideo[0] || null;
};

/**
 * Combine all segments into a single Uint8Array
 *
 * @param {Object} segmentObj
 * @return {Uint8Array} concatenated bytes
 * @private
 */
var concatSegments = function concatSegments(segmentObj) {
  var offset = 0;
  var tempBuffer;

  if (segmentObj.bytes) {
    tempBuffer = new Uint8Array(segmentObj.bytes); // combine the individual segments into one large typed-array

    segmentObj.segments.forEach(function (segment) {
      tempBuffer.set(segment, offset);
      offset += segment.byteLength;
    });
  }

  return tempBuffer;
};
/**
 * Example:
 * https://host.com/path1/path2/path3/segment.ts?arg1=val1
 * -->
 * path3/segment.ts
 *
 * @param resolvedUri
 * @return {string}
 */

function compactSegmentUrlDescription(resolvedUri) {
  try {
    return new URL(resolvedUri).pathname.split('/').slice(-2).join('/');
  } catch (e) {
    return '';
  }
}

/**
 * @file text-tracks.js
 */
/**
 * Create captions text tracks on video.js if they do not exist
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {Object} tech the video.js tech
 * @param {Object} captionStream the caption stream to create
 * @private
 */

var createCaptionsTrackIfNotExists = function createCaptionsTrackIfNotExists(inbandTextTracks, tech, captionStream) {
  if (!inbandTextTracks[captionStream]) {
    tech.trigger({
      type: 'usage',
      name: 'vhs-608'
    });
    var instreamId = captionStream; // we need to translate SERVICEn for 708 to how mux.js currently labels them

    if (/^cc708_/.test(captionStream)) {
      instreamId = 'SERVICE' + captionStream.split('_')[1];
    }

    var track = tech.textTracks().getTrackById(instreamId);

    if (track) {
      // Resuse an existing track with a CC# id because this was
      // very likely created by videojs-contrib-hls from information
      // in the m3u8 for us to use
      inbandTextTracks[captionStream] = track;
    } else {
      // This section gets called when we have caption services that aren't specified in the manifest.
      // Manifest level caption services are handled in media-groups.js under CLOSED-CAPTIONS.
      var captionServices = tech.options_.vhs && tech.options_.vhs.captionServices || {};
      var label = captionStream;
      var language = captionStream;
      var def = false;
      var captionService = captionServices[instreamId];

      if (captionService) {
        label = captionService.label;
        language = captionService.language;
        def = captionService.default;
      } // Otherwise, create a track with the default `CC#` label and
      // without a language


      inbandTextTracks[captionStream] = tech.addRemoteTextTrack({
        kind: 'captions',
        id: instreamId,
        // TODO: investigate why this doesn't seem to turn the caption on by default
        default: def,
        label: label,
        language: language
      }, false).track;
    }
  }
};
/**
 * Add caption text track data to a source handler given an array of captions
 *
 * @param {Object}
 *   @param {Object} inbandTextTracks the inband text tracks
 *   @param {number} timestampOffset the timestamp offset of the source buffer
 *   @param {Array} captionArray an array of caption data
 * @private
 */

var addCaptionData = function addCaptionData(_ref) {
  var inbandTextTracks = _ref.inbandTextTracks,
      captionArray = _ref.captionArray,
      timestampOffset = _ref.timestampOffset;

  if (!captionArray) {
    return;
  }

  var Cue = window$1.WebKitDataCue || window$1.VTTCue;
  captionArray.forEach(function (caption) {
    var track = caption.stream; // in CEA 608 captions, video.js/mux.js sends a content array
    // with positioning data

    if (caption.content) {
      caption.content.forEach(function (value) {
        var cue = new Cue(caption.startTime + timestampOffset, caption.endTime + timestampOffset, value.text);
        cue.line = value.line;
        cue.align = 'left';
        cue.position = value.position;
        cue.positionAlign = 'line-left';
        inbandTextTracks[track].addCue(cue);
      });
    } else {
      // otherwise, a text value with combined captions is sent
      inbandTextTracks[track].addCue(new Cue(caption.startTime + timestampOffset, caption.endTime + timestampOffset, caption.text));
    }
  });
};
/**
 * Define properties on a cue for backwards compatability,
 * but warn the user that the way that they are using it
 * is depricated and will be removed at a later date.
 *
 * @param {Cue} cue the cue to add the properties on
 * @private
 */

var deprecateOldCue = function deprecateOldCue(cue) {
  Object.defineProperties(cue.frame, {
    id: {
      get: function get() {
        videojs.log.warn('cue.frame.id is deprecated. Use cue.value.key instead.');
        return cue.value.key;
      }
    },
    value: {
      get: function get() {
        videojs.log.warn('cue.frame.value is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    },
    privateData: {
      get: function get() {
        videojs.log.warn('cue.frame.privateData is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    }
  });
};
/**
 * Add metadata text track data to a source handler given an array of metadata
 *
 * @param {Object}
 *   @param {Object} inbandTextTracks the inband text tracks
 *   @param {Array} metadataArray an array of meta data
 *   @param {number} timestampOffset the timestamp offset of the source buffer
 *   @param {number} videoDuration the duration of the video
 * @private
 */


var addMetadata = function addMetadata(_ref2) {
  var inbandTextTracks = _ref2.inbandTextTracks,
      metadataArray = _ref2.metadataArray,
      timestampOffset = _ref2.timestampOffset,
      videoDuration = _ref2.videoDuration;

  if (!metadataArray) {
    return;
  }

  var Cue = window$1.WebKitDataCue || window$1.VTTCue;
  var metadataTrack = inbandTextTracks.metadataTrack_;

  if (!metadataTrack) {
    return;
  }

  metadataArray.forEach(function (metadata) {
    var time = metadata.cueTime + timestampOffset; // if time isn't a finite number between 0 and Infinity, like NaN,
    // ignore this bit of metadata.
    // This likely occurs when you have an non-timed ID3 tag like TIT2,
    // which is the "Title/Songname/Content description" frame

    if (typeof time !== 'number' || window$1.isNaN(time) || time < 0 || !(time < Infinity)) {
      return;
    } // If we have no frames, we can't create a cue.


    if (!metadata.frames || !metadata.frames.length) {
      return;
    }

    metadata.frames.forEach(function (frame) {
      var cue = new Cue(time, time, frame.value || frame.url || frame.data || '');
      cue.frame = frame;
      cue.value = frame;
      deprecateOldCue(cue);
      metadataTrack.addCue(cue);
    });
  });

  if (!metadataTrack.cues || !metadataTrack.cues.length) {
    return;
  } // Updating the metadeta cues so that
  // the endTime of each cue is the startTime of the next cue
  // the endTime of last cue is the duration of the video


  var cues = metadataTrack.cues;
  var cuesArray = []; // Create a copy of the TextTrackCueList...
  // ...disregarding cues with a falsey value

  for (var i = 0; i < cues.length; i++) {
    if (cues[i]) {
      cuesArray.push(cues[i]);
    }
  } // Group cues by their startTime value


  var cuesGroupedByStartTime = cuesArray.reduce(function (obj, cue) {
    var timeSlot = obj[cue.startTime] || [];
    timeSlot.push(cue);
    obj[cue.startTime] = timeSlot;
    return obj;
  }, {}); // Sort startTimes by ascending order

  var sortedStartTimes = Object.keys(cuesGroupedByStartTime).sort(function (a, b) {
    return Number(a) - Number(b);
  }); // Map each cue group's endTime to the next group's startTime

  sortedStartTimes.forEach(function (startTime, idx) {
    var cueGroup = cuesGroupedByStartTime[startTime];
    var finiteDuration = isFinite(videoDuration) ? videoDuration : startTime;
    var nextTime = Number(sortedStartTimes[idx + 1]) || finiteDuration; // Map each cue's endTime the next group's startTime

    cueGroup.forEach(function (cue) {
      cue.endTime = nextTime;
    });
  });
}; // object for mapping daterange attributes

var dateRangeAttr = {
  id: 'ID',
  class: 'CLASS',
  startDate: 'START-DATE',
  duration: 'DURATION',
  endDate: 'END-DATE',
  endOnNext: 'END-ON-NEXT',
  plannedDuration: 'PLANNED-DURATION',
  scte35Out: 'SCTE35-OUT',
  scte35In: 'SCTE35-IN'
};
var dateRangeKeysToOmit = new Set(['id', 'class', 'startDate', 'duration', 'endDate', 'endOnNext', 'startTime', 'endTime', 'processDateRange']);
/**
 * Add DateRange metadata text track to a source handler given an array of metadata
 *
 * @param {Object}
 *   @param {Object} inbandTextTracks the inband text tracks
 *   @param {Array} dateRanges parsed media playlist
 * @private
 */

var addDateRangeMetadata = function addDateRangeMetadata(_ref3) {
  var inbandTextTracks = _ref3.inbandTextTracks,
      dateRanges = _ref3.dateRanges;
  var metadataTrack = inbandTextTracks.metadataTrack_;

  if (!metadataTrack) {
    return;
  }

  var Cue = window$1.WebKitDataCue || window$1.VTTCue;
  dateRanges.forEach(function (dateRange) {
    // we generate multiple cues for each date range with different attributes
    for (var _i = 0, _Object$keys = Object.keys(dateRange); _i < _Object$keys.length; _i++) {
      var key = _Object$keys[_i];

      if (dateRangeKeysToOmit.has(key)) {
        continue;
      }

      var cue = new Cue(dateRange.startTime, dateRange.endTime, '');
      cue.id = dateRange.id;
      cue.type = 'com.apple.quicktime.HLS';
      cue.value = {
        key: dateRangeAttr[key],
        data: dateRange[key]
      };

      if (key === 'scte35Out' || key === 'scte35In') {
        cue.value.data = new Uint8Array(cue.value.data.match(/[\da-f]{2}/gi)).buffer;
      }

      metadataTrack.addCue(cue);
    }

    dateRange.processDateRange();
  });
};
/**
 * Create metadata text track on video.js if it does not exist
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {string} dispatchType the inband metadata track dispatch type
 * @param {Object} tech the video.js tech
 * @private
 */

var createMetadataTrackIfNotExists = function createMetadataTrackIfNotExists(inbandTextTracks, dispatchType, tech) {
  if (inbandTextTracks.metadataTrack_) {
    return;
  }

  inbandTextTracks.metadataTrack_ = tech.addRemoteTextTrack({
    kind: 'metadata',
    label: 'Timed Metadata'
  }, false).track;

  if (!videojs.browser.IS_ANY_SAFARI) {
    inbandTextTracks.metadataTrack_.inBandMetadataTrackDispatchType = dispatchType;
  }
};
/**
 * Remove cues from a track on video.js.
 *
 * @param {Double} start start of where we should remove the cue
 * @param {Double} end end of where the we should remove the cue
 * @param {Object} track the text track to remove the cues from
 * @private
 */

var removeCuesFromTrack = function removeCuesFromTrack(start, end, track) {
  var i;
  var cue;

  if (!track) {
    return;
  }

  if (!track.cues) {
    return;
  }

  i = track.cues.length;

  while (i--) {
    cue = track.cues[i]; // Remove any cue within the provided start and end time

    if (cue.startTime >= start && cue.endTime <= end) {
      track.removeCue(cue);
    }
  }
};
/**
 * Remove duplicate cues from a track on video.js (a cue is considered a
 * duplicate if it has the same time interval and text as another)
 *
 * @param {Object} track the text track to remove the duplicate cues from
 * @private
 */

var removeDuplicateCuesFromTrack = function removeDuplicateCuesFromTrack(track) {
  var cues = track.cues;

  if (!cues) {
    return;
  }

  var uniqueCues = {};

  for (var i = cues.length - 1; i >= 0; i--) {
    var cue = cues[i];
    var cueKey = cue.startTime + "-" + cue.endTime + "-" + cue.text;

    if (uniqueCues[cueKey]) {
      track.removeCue(cue);
    } else {
      uniqueCues[cueKey] = cue;
    }
  }
};

/**
 * Returns a list of gops in the buffer that have a pts value of 3 seconds or more in
 * front of current time.
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {number} currentTime
 *        The current time
 * @param {Double} mapping
 *        Offset to map display time to stream presentation time
 * @return {Array}
 *         List of gops considered safe to append over
 */

var gopsSafeToAlignWith = function gopsSafeToAlignWith(buffer, currentTime, mapping) {
  if (typeof currentTime === 'undefined' || currentTime === null || !buffer.length) {
    return [];
  } // pts value for current time + 3 seconds to give a bit more wiggle room


  var currentTimePts = Math.ceil((currentTime - mapping + 3) * ONE_SECOND_IN_TS);
  var i;

  for (i = 0; i < buffer.length; i++) {
    if (buffer[i].pts > currentTimePts) {
      break;
    }
  }

  return buffer.slice(i);
};
/**
 * Appends gop information (timing and byteLength) received by the transmuxer for the
 * gops appended in the last call to appendBuffer
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {Array} gops
 *        List of new gop information
 * @param {boolean} replace
 *        If true, replace the buffer with the new gop information. If false, append the
 *        new gop information to the buffer in the right location of time.
 * @return {Array}
 *         Updated list of gop information
 */

var updateGopBuffer = function updateGopBuffer(buffer, gops, replace) {
  if (!gops.length) {
    return buffer;
  }

  if (replace) {
    // If we are in safe append mode, then completely overwrite the gop buffer
    // with the most recent appeneded data. This will make sure that when appending
    // future segments, we only try to align with gops that are both ahead of current
    // time and in the last segment appended.
    return gops.slice();
  }

  var start = gops[0].pts;
  var i = 0;

  for (i; i < buffer.length; i++) {
    if (buffer[i].pts >= start) {
      break;
    }
  }

  return buffer.slice(0, i).concat(gops);
};
/**
 * Removes gop information in buffer that overlaps with provided start and end
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {Double} start
 *        position to start the remove at
 * @param {Double} end
 *        position to end the remove at
 * @param {Double} mapping
 *        Offset to map display time to stream presentation time
 */

var removeGopBuffer = function removeGopBuffer(buffer, start, end, mapping) {
  var startPts = Math.ceil((start - mapping) * ONE_SECOND_IN_TS);
  var endPts = Math.ceil((end - mapping) * ONE_SECOND_IN_TS);
  var updatedBuffer = buffer.slice();
  var i = buffer.length;

  while (i--) {
    if (buffer[i].pts <= endPts) {
      break;
    }
  }

  if (i === -1) {
    // no removal because end of remove range is before start of buffer
    return updatedBuffer;
  }

  var j = i + 1;

  while (j--) {
    if (buffer[j].pts <= startPts) {
      break;
    }
  } // clamp remove range start to 0 index


  j = Math.max(j, 0);
  updatedBuffer.splice(j, i - j + 1);
  return updatedBuffer;
};

var shallowEqual = function shallowEqual(a, b) {
  // if both are undefined
  // or one or the other is undefined
  // they are not equal
  if (!a && !b || !a && b || a && !b) {
    return false;
  } // they are the same object and thus, equal


  if (a === b) {
    return true;
  } // sort keys so we can make sure they have
  // all the same keys later.


  var akeys = Object.keys(a).sort();
  var bkeys = Object.keys(b).sort(); // different number of keys, not equal

  if (akeys.length !== bkeys.length) {
    return false;
  }

  for (var i = 0; i < akeys.length; i++) {
    var key = akeys[i]; // different sorted keys, not equal

    if (key !== bkeys[i]) {
      return false;
    } // different values, not equal


    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
};

// https://www.w3.org/TR/WebIDL-1/#quotaexceedederror
var QUOTA_EXCEEDED_ERR = 22;

/**
 * The segment loader has no recourse except to fetch a segment in the
 * current playlist and use the internal timestamps in that segment to
 * generate a syncPoint. This function returns a good candidate index
 * for that process.
 *
 * @param {Array} segments - the segments array from a playlist.
 * @return {number} An index of a segment from the playlist to load
 */

var getSyncSegmentCandidate = function getSyncSegmentCandidate(currentTimeline, segments, targetTime) {
  segments = segments || [];
  var timelineSegments = [];
  var time = 0;

  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];

    if (currentTimeline === segment.timeline) {
      timelineSegments.push(i);
      time += segment.duration;

      if (time > targetTime) {
        return i;
      }
    }
  }

  if (timelineSegments.length === 0) {
    return 0;
  } // default to the last timeline segment


  return timelineSegments[timelineSegments.length - 1];
}; // In the event of a quota exceeded error, keep at least one second of back buffer. This
// number was arbitrarily chosen and may be updated in the future, but seemed reasonable
// as a start to prevent any potential issues with removing content too close to the
// playhead.

var MIN_BACK_BUFFER = 1; // in ms

var CHECK_BUFFER_DELAY = 500;

var finite = function finite(num) {
  return typeof num === 'number' && isFinite(num);
}; // With most content hovering around 30fps, if a segment has a duration less than a half
// frame at 30fps or one frame at 60fps, the bandwidth and throughput calculations will
// not accurately reflect the rest of the content.


var MIN_SEGMENT_DURATION_TO_SAVE_STATS = 1 / 60;
var illegalMediaSwitch = function illegalMediaSwitch(loaderType, startingMedia, trackInfo) {
  // Although these checks should most likely cover non 'main' types, for now it narrows
  // the scope of our checks.
  if (loaderType !== 'main' || !startingMedia || !trackInfo) {
    return null;
  }

  if (!trackInfo.hasAudio && !trackInfo.hasVideo) {
    return 'Neither audio nor video found in segment.';
  }

  if (startingMedia.hasVideo && !trackInfo.hasVideo) {
    return 'Only audio found in segment when we expected video.' + ' We can\'t switch to audio only from a stream that had video.' + ' To get rid of this message, please add codec information to the manifest.';
  }

  if (!startingMedia.hasVideo && trackInfo.hasVideo) {
    return 'Video found in segment when we expected only audio.' + ' We can\'t switch to a stream with video from an audio only stream.' + ' To get rid of this message, please add codec information to the manifest.';
  }

  return null;
};
/**
 * Calculates a time value that is safe to remove from the back buffer without interrupting
 * playback.
 *
 * @param {TimeRange} seekable
 *        The current seekable range
 * @param {number} currentTime
 *        The current time of the player
 * @param {number} targetDuration
 *        The target duration of the current playlist
 * @return {number}
 *         Time that is safe to remove from the back buffer without interrupting playback
 */

var safeBackBufferTrimTime = function safeBackBufferTrimTime(seekable, currentTime, targetDuration) {
  // 30 seconds before the playhead provides a safe default for trimming.
  //
  // Choosing a reasonable default is particularly important for high bitrate content and
  // VOD videos/live streams with large windows, as the buffer may end up overfilled and
  // throw an APPEND_BUFFER_ERR.
  var trimTime = currentTime - Config.BACK_BUFFER_LENGTH;

  if (seekable.length) {
    // Some live playlists may have a shorter window of content than the full allowed back
    // buffer. For these playlists, don't save content that's no longer within the window.
    trimTime = Math.max(trimTime, seekable.start(0));
  } // Don't remove within target duration of the current time to avoid the possibility of
  // removing the GOP currently being played, as removing it can cause playback stalls.


  var maxTrimTime = currentTime - targetDuration;
  return Math.min(maxTrimTime, trimTime);
};
var segmentInfoString = function segmentInfoString(segmentInfo) {
  var startOfSegment = segmentInfo.startOfSegment,
      duration = segmentInfo.duration,
      segment = segmentInfo.segment,
      part = segmentInfo.part,
      _segmentInfo$playlist = segmentInfo.playlist,
      seq = _segmentInfo$playlist.mediaSequence,
      id = _segmentInfo$playlist.id,
      _segmentInfo$playlist2 = _segmentInfo$playlist.segments,
      segments = _segmentInfo$playlist2 === void 0 ? [] : _segmentInfo$playlist2,
      index = segmentInfo.mediaIndex,
      partIndex = segmentInfo.partIndex,
      timeline = segmentInfo.timeline;
  var segmentLen = segments.length - 1;
  var selection = 'mediaIndex/partIndex increment';

  if (segmentInfo.getMediaInfoForTime) {
    selection = "getMediaInfoForTime (" + segmentInfo.getMediaInfoForTime + ")";
  } else if (segmentInfo.isSyncRequest) {
    selection = 'getSyncSegmentCandidate (isSyncRequest)';
  }

  if (segmentInfo.independent) {
    selection += " with independent " + segmentInfo.independent;
  }

  var hasPartIndex = typeof partIndex === 'number';
  var name = segmentInfo.segment.uri ? 'segment' : 'pre-segment';
  var zeroBasedPartCount = hasPartIndex ? getKnownPartCount({
    preloadSegment: segment
  }) - 1 : 0;
  return name + " [" + (seq + index) + "/" + (seq + segmentLen) + "]" + (hasPartIndex ? " part [" + partIndex + "/" + zeroBasedPartCount + "]" : '') + (" segment start/end [" + segment.start + " => " + segment.end + "]") + (hasPartIndex ? " part start/end [" + part.start + " => " + part.end + "]" : '') + (" startOfSegment [" + startOfSegment + "]") + (" duration [" + duration + "]") + (" timeline [" + timeline + "]") + (" selected by [" + selection + "]") + (" playlist [" + id + "]");
};

var timingInfoPropertyForMedia = function timingInfoPropertyForMedia(mediaType) {
  return mediaType + "TimingInfo";
};
/**
 * Returns the timestamp offset to use for the segment.
 *
 * @param {number} segmentTimeline
 *        The timeline of the segment
 * @param {number} currentTimeline
 *        The timeline currently being followed by the loader
 * @param {number} startOfSegment
 *        The estimated segment start
 * @param {TimeRange[]} buffered
 *        The loader's buffer
 * @param {boolean} overrideCheck
 *        If true, no checks are made to see if the timestamp offset value should be set,
 *        but sets it directly to a value.
 *
 * @return {number|null}
 *         Either a number representing a new timestamp offset, or null if the segment is
 *         part of the same timeline
 */


var timestampOffsetForSegment = function timestampOffsetForSegment(_ref) {
  var segmentTimeline = _ref.segmentTimeline,
      currentTimeline = _ref.currentTimeline,
      startOfSegment = _ref.startOfSegment,
      buffered = _ref.buffered,
      overrideCheck = _ref.overrideCheck;

  // Check to see if we are crossing a discontinuity to see if we need to set the
  // timestamp offset on the transmuxer and source buffer.
  //
  // Previously, we changed the timestampOffset if the start of this segment was less than
  // the currently set timestampOffset, but this isn't desirable as it can produce bad
  // behavior, especially around long running live streams.
  if (!overrideCheck && segmentTimeline === currentTimeline) {
    return null;
  } // When changing renditions, it's possible to request a segment on an older timeline. For
  // instance, given two renditions with the following:
  //
  // #EXTINF:10
  // segment1
  // #EXT-X-DISCONTINUITY
  // #EXTINF:10
  // segment2
  // #EXTINF:10
  // segment3
  //
  // And the current player state:
  //
  // current time: 8
  // buffer: 0 => 20
  //
  // The next segment on the current rendition would be segment3, filling the buffer from
  // 20s onwards. However, if a rendition switch happens after segment2 was requested,
  // then the next segment to be requested will be segment1 from the new rendition in
  // order to fill time 8 and onwards. Using the buffered end would result in repeated
  // content (since it would position segment1 of the new rendition starting at 20s). This
  // case can be identified when the new segment's timeline is a prior value. Instead of
  // using the buffered end, the startOfSegment can be used, which, hopefully, will be
  // more accurate to the actual start time of the segment.


  if (segmentTimeline < currentTimeline) {
    return startOfSegment;
  } // segmentInfo.startOfSegment used to be used as the timestamp offset, however, that
  // value uses the end of the last segment if it is available. While this value
  // should often be correct, it's better to rely on the buffered end, as the new
  // content post discontinuity should line up with the buffered end as if it were
  // time 0 for the new content.


  return buffered.length ? buffered.end(buffered.length - 1) : startOfSegment;
};
/**
 * Returns whether or not the loader should wait for a timeline change from the timeline
 * change controller before processing the segment.
 *
 * Primary timing in VHS goes by video. This is different from most media players, as
 * audio is more often used as the primary timing source. For the foreseeable future, VHS
 * will continue to use video as the primary timing source, due to the current logic and
 * expectations built around it.

 * Since the timing follows video, in order to maintain sync, the video loader is
 * responsible for setting both audio and video source buffer timestamp offsets.
 *
 * Setting different values for audio and video source buffers could lead to
 * desyncing. The following examples demonstrate some of the situations where this
 * distinction is important. Note that all of these cases involve demuxed content. When
 * content is muxed, the audio and video are packaged together, therefore syncing
 * separate media playlists is not an issue.
 *
 * CASE 1: Audio prepares to load a new timeline before video:
 *
 * Timeline:       0                 1
 * Audio Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Audio Loader:                     ^
 * Video Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Video Loader              ^
 *
 * In the above example, the audio loader is preparing to load the 6th segment, the first
 * after a discontinuity, while the video loader is still loading the 5th segment, before
 * the discontinuity.
 *
 * If the audio loader goes ahead and loads and appends the 6th segment before the video
 * loader crosses the discontinuity, then when appended, the 6th audio segment will use
 * the timestamp offset from timeline 0. This will likely lead to desyncing. In addition,
 * the audio loader must provide the audioAppendStart value to trim the content in the
 * transmuxer, and that value relies on the audio timestamp offset. Since the audio
 * timestamp offset is set by the video (main) loader, the audio loader shouldn't load the
 * segment until that value is provided.
 *
 * CASE 2: Video prepares to load a new timeline before audio:
 *
 * Timeline:       0                 1
 * Audio Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Audio Loader:             ^
 * Video Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Video Loader                      ^
 *
 * In the above example, the video loader is preparing to load the 6th segment, the first
 * after a discontinuity, while the audio loader is still loading the 5th segment, before
 * the discontinuity.
 *
 * If the video loader goes ahead and loads and appends the 6th segment, then once the
 * segment is loaded and processed, both the video and audio timestamp offsets will be
 * set, since video is used as the primary timing source. This is to ensure content lines
 * up appropriately, as any modifications to the video timing are reflected by audio when
 * the video loader sets the audio and video timestamp offsets to the same value. However,
 * setting the timestamp offset for audio before audio has had a chance to change
 * timelines will likely lead to desyncing, as the audio loader will append segment 5 with
 * a timestamp intended to apply to segments from timeline 1 rather than timeline 0.
 *
 * CASE 3: When seeking, audio prepares to load a new timeline before video
 *
 * Timeline:       0                 1
 * Audio Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Audio Loader:           ^
 * Video Segments: 0 1 2 3 4 5 DISCO 6 7 8 9
 * Video Loader            ^
 *
 * In the above example, both audio and video loaders are loading segments from timeline
 * 0, but imagine that the seek originated from timeline 1.
 *
 * When seeking to a new timeline, the timestamp offset will be set based on the expected
 * segment start of the loaded video segment. In order to maintain sync, the audio loader
 * must wait for the video loader to load its segment and update both the audio and video
 * timestamp offsets before it may load and append its own segment. This is the case
 * whether the seek results in a mismatched segment request (e.g., the audio loader
 * chooses to load segment 3 and the video loader chooses to load segment 4) or the
 * loaders choose to load the same segment index from each playlist, as the segments may
 * not be aligned perfectly, even for matching segment indexes.
 *
 * @param {Object} timelinechangeController
 * @param {number} currentTimeline
 *        The timeline currently being followed by the loader
 * @param {number} segmentTimeline
 *        The timeline of the segment being loaded
 * @param {('main'|'audio')} loaderType
 *        The loader type
 * @param {boolean} audioDisabled
 *        Whether the audio is disabled for the loader. This should only be true when the
 *        loader may have muxed audio in its segment, but should not append it, e.g., for
 *        the main loader when an alternate audio playlist is active.
 *
 * @return {boolean}
 *         Whether the loader should wait for a timeline change from the timeline change
 *         controller before processing the segment
 */

var shouldWaitForTimelineChange = function shouldWaitForTimelineChange(_ref2) {
  var timelineChangeController = _ref2.timelineChangeController,
      currentTimeline = _ref2.currentTimeline,
      segmentTimeline = _ref2.segmentTimeline,
      loaderType = _ref2.loaderType,
      audioDisabled = _ref2.audioDisabled;

  if (currentTimeline === segmentTimeline) {
    return false;
  }

  if (loaderType === 'audio') {
    var lastMainTimelineChange = timelineChangeController.lastTimelineChange({
      type: 'main'
    }); // Audio loader should wait if:
    //
    // * main hasn't had a timeline change yet (thus has not loaded its first segment)
    // * main hasn't yet changed to the timeline audio is looking to load

    return !lastMainTimelineChange || lastMainTimelineChange.to !== segmentTimeline;
  } // The main loader only needs to wait for timeline changes if there's demuxed audio.
  // Otherwise, there's nothing to wait for, since audio would be muxed into the main
  // loader's segments (or the content is audio/video only and handled by the main
  // loader).


  if (loaderType === 'main' && audioDisabled) {
    var pendingAudioTimelineChange = timelineChangeController.pendingTimelineChange({
      type: 'audio'
    }); // Main loader should wait for the audio loader if audio is not pending a timeline
    // change to the current timeline.
    //
    // Since the main loader is responsible for setting the timestamp offset for both
    // audio and video, the main loader must wait for audio to be about to change to its
    // timeline before setting the offset, otherwise, if audio is behind in loading,
    // segments from the previous timeline would be adjusted by the new timestamp offset.
    //
    // This requirement means that video will not cross a timeline until the audio is
    // about to cross to it, so that way audio and video will always cross the timeline
    // together.
    //
    // In addition to normal timeline changes, these rules also apply to the start of a
    // stream (going from a non-existent timeline, -1, to timeline 0). It's important
    // that these rules apply to the first timeline change because if they did not, it's
    // possible that the main loader will cross two timelines before the audio loader has
    // crossed one. Logic may be implemented to handle the startup as a special case, but
    // it's easier to simply treat all timeline changes the same.

    if (pendingAudioTimelineChange && pendingAudioTimelineChange.to === segmentTimeline) {
      return false;
    }

    return true;
  }

  return false;
};
var mediaDuration = function mediaDuration(timingInfos) {
  var maxDuration = 0;
  ['video', 'audio'].forEach(function (type) {
    var typeTimingInfo = timingInfos[type + "TimingInfo"];

    if (!typeTimingInfo) {
      return;
    }

    var start = typeTimingInfo.start,
        end = typeTimingInfo.end;
    var duration;

    if (typeof start === 'bigint' || typeof end === 'bigint') {
      duration = window$1.BigInt(end) - window$1.BigInt(start);
    } else if (typeof start === 'number' && typeof end === 'number') {
      duration = end - start;
    }

    if (typeof duration !== 'undefined' && duration > maxDuration) {
      maxDuration = duration;
    }
  }); // convert back to a number if it is lower than MAX_SAFE_INTEGER
  // as we only need BigInt when we are above that.

  if (typeof maxDuration === 'bigint' && maxDuration < Number.MAX_SAFE_INTEGER) {
    maxDuration = Number(maxDuration);
  }

  return maxDuration;
};
var segmentTooLong = function segmentTooLong(_ref3) {
  var segmentDuration = _ref3.segmentDuration,
      maxDuration = _ref3.maxDuration;

  // 0 duration segments are most likely due to metadata only segments or a lack of
  // information.
  if (!segmentDuration) {
    return false;
  } // For HLS:
  //
  // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.3.1
  // The EXTINF duration of each Media Segment in the Playlist
  // file, when rounded to the nearest integer, MUST be less than or equal
  // to the target duration; longer segments can trigger playback stalls
  // or other errors.
  //
  // For DASH, the mpd-parser uses the largest reported segment duration as the target
  // duration. Although that reported duration is occasionally approximate (i.e., not
  // exact), a strict check may report that a segment is too long more often in DASH.


  return Math.round(segmentDuration) > maxDuration + TIME_FUDGE_FACTOR;
};
var getTroublesomeSegmentDurationMessage = function getTroublesomeSegmentDurationMessage(segmentInfo, sourceType) {
  // Right now we aren't following DASH's timing model exactly, so only perform
  // this check for HLS content.
  if (sourceType !== 'hls') {
    return null;
  }

  var segmentDuration = mediaDuration({
    audioTimingInfo: segmentInfo.audioTimingInfo,
    videoTimingInfo: segmentInfo.videoTimingInfo
  }); // Don't report if we lack information.
  //
  // If the segment has a duration of 0 it is either a lack of information or a
  // metadata only segment and shouldn't be reported here.

  if (!segmentDuration) {
    return null;
  }

  var targetDuration = segmentInfo.playlist.targetDuration;
  var isSegmentWayTooLong = segmentTooLong({
    segmentDuration: segmentDuration,
    maxDuration: targetDuration * 2
  });
  var isSegmentSlightlyTooLong = segmentTooLong({
    segmentDuration: segmentDuration,
    maxDuration: targetDuration
  });
  var segmentTooLongMessage = "Segment with index " + segmentInfo.mediaIndex + " " + ("from playlist " + segmentInfo.playlist.id + " ") + ("has a duration of " + segmentDuration + " ") + ("when the reported duration is " + segmentInfo.duration + " ") + ("and the target duration is " + targetDuration + ". ") + 'For HLS content, a duration in excess of the target duration may result in ' + 'playback issues. See the HLS specification section on EXT-X-TARGETDURATION for ' + 'more details: ' + 'https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.3.1';

  if (isSegmentWayTooLong || isSegmentSlightlyTooLong) {
    return {
      severity: isSegmentWayTooLong ? 'warn' : 'info',
      message: segmentTooLongMessage
    };
  }

  return null;
};
/**
 * An object that manages segment loading and appending.
 *
 * @class SegmentLoader
 * @param {Object} options required and optional options
 * @extends videojs.EventTarget
 */

var SegmentLoader = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(SegmentLoader, _videojs$EventTarget);

  function SegmentLoader(settings, options) {
    var _this;

    _this = _videojs$EventTarget.call(this) || this; // check pre-conditions

    if (!settings) {
      throw new TypeError('Initialization settings are required');
    }

    if (typeof settings.currentTime !== 'function') {
      throw new TypeError('No currentTime getter specified');
    }

    if (!settings.mediaSource) {
      throw new TypeError('No MediaSource specified');
    } // public properties


    _this.bandwidth = settings.bandwidth;
    _this.throughput = {
      rate: 0,
      count: 0
    };
    _this.roundTrip = NaN;

    _this.resetStats_();

    _this.mediaIndex = null;
    _this.partIndex = null; // private settings

    _this.hasPlayed_ = settings.hasPlayed;
    _this.currentTime_ = settings.currentTime;
    _this.seekable_ = settings.seekable;
    _this.seeking_ = settings.seeking;
    _this.duration_ = settings.duration;
    _this.mediaSource_ = settings.mediaSource;
    _this.vhs_ = settings.vhs;
    _this.loaderType_ = settings.loaderType;
    _this.currentMediaInfo_ = void 0;
    _this.startingMediaInfo_ = void 0;
    _this.segmentMetadataTrack_ = settings.segmentMetadataTrack;
    _this.goalBufferLength_ = settings.goalBufferLength;
    _this.sourceType_ = settings.sourceType;
    _this.sourceUpdater_ = settings.sourceUpdater;
    _this.inbandTextTracks_ = settings.inbandTextTracks;
    _this.state_ = 'INIT';
    _this.timelineChangeController_ = settings.timelineChangeController;
    _this.shouldSaveSegmentTimingInfo_ = true;
    _this.parse708captions_ = settings.parse708captions;
    _this.useDtsForTimestampOffset_ = settings.useDtsForTimestampOffset;
    _this.captionServices_ = settings.captionServices;
    _this.exactManifestTimings = settings.exactManifestTimings;
    _this.addMetadataToTextTrack = settings.addMetadataToTextTrack; // private instance variables

    _this.checkBufferTimeout_ = null;
    _this.error_ = void 0;
    _this.currentTimeline_ = -1;
    _this.shouldForceTimestampOffsetAfterResync_ = false;
    _this.pendingSegment_ = null;
    _this.xhrOptions_ = null;
    _this.pendingSegments_ = [];
    _this.audioDisabled_ = false;
    _this.isPendingTimestampOffset_ = false; // TODO possibly move gopBuffer and timeMapping info to a separate controller

    _this.gopBuffer_ = [];
    _this.timeMapping_ = 0;
    _this.safeAppend_ = false;
    _this.appendInitSegment_ = {
      audio: true,
      video: true
    };
    _this.playlistOfLastInitSegment_ = {
      audio: null,
      video: null
    };
    _this.callQueue_ = []; // If the segment loader prepares to load a segment, but does not have enough
    // information yet to start the loading process (e.g., if the audio loader wants to
    // load a segment from the next timeline but the main loader hasn't yet crossed that
    // timeline), then the load call will be added to the queue until it is ready to be
    // processed.

    _this.loadQueue_ = [];
    _this.metadataQueue_ = {
      id3: [],
      caption: []
    };
    _this.waitingOnRemove_ = false;
    _this.quotaExceededErrorRetryTimeout_ = null; // Fragmented mp4 playback

    _this.activeInitSegmentId_ = null;
    _this.initSegments_ = {}; // HLSe playback

    _this.cacheEncryptionKeys_ = settings.cacheEncryptionKeys;
    _this.keyCache_ = {};
    _this.decrypter_ = settings.decrypter; // Manages the tracking and generation of sync-points, mappings
    // between a time in the display time and a segment index within
    // a playlist

    _this.syncController_ = settings.syncController;
    _this.syncPoint_ = {
      segmentIndex: 0,
      time: 0
    };
    _this.transmuxer_ = _this.createTransmuxer_();

    _this.triggerSyncInfoUpdate_ = function () {
      return _this.trigger('syncinfoupdate');
    };

    _this.syncController_.on('syncinfoupdate', _this.triggerSyncInfoUpdate_);

    _this.mediaSource_.addEventListener('sourceopen', function () {
      if (!_this.isEndOfStream_()) {
        _this.ended_ = false;
      }
    }); // ...for determining the fetch location


    _this.fetchAtBuffer_ = false;
    _this.logger_ = logger("SegmentLoader[" + _this.loaderType_ + "]");
    Object.defineProperty(_assertThisInitialized(_this), 'state', {
      get: function get() {
        return this.state_;
      },
      set: function set(newState) {
        if (newState !== this.state_) {
          this.logger_(this.state_ + " -> " + newState);
          this.state_ = newState;
          this.trigger('statechange');
        }
      }
    });

    _this.sourceUpdater_.on('ready', function () {
      if (_this.hasEnoughInfoToAppend_()) {
        _this.processCallQueue_();
      }
    }); // Only the main loader needs to listen for pending timeline changes, as the main
    // loader should wait for audio to be ready to change its timeline so that both main
    // and audio timelines change together. For more details, see the
    // shouldWaitForTimelineChange function.


    if (_this.loaderType_ === 'main') {
      _this.timelineChangeController_.on('pendingtimelinechange', function () {
        if (_this.hasEnoughInfoToAppend_()) {
          _this.processCallQueue_();
        }
      });
    } // The main loader only listens on pending timeline changes, but the audio loader,
    // since its loads follow main, needs to listen on timeline changes. For more details,
    // see the shouldWaitForTimelineChange function.


    if (_this.loaderType_ === 'audio') {
      _this.timelineChangeController_.on('timelinechange', function () {
        if (_this.hasEnoughInfoToLoad_()) {
          _this.processLoadQueue_();
        }

        if (_this.hasEnoughInfoToAppend_()) {
          _this.processCallQueue_();
        }
      });
    }

    return _this;
  }
  /**
   * TODO: Current sync controller consists of many hls-specific strategies
   * media sequence sync is also hls-specific, and we would like to be protocol-agnostic on this level
   * this should be a part of the sync-controller and sync controller should expect different strategy list based on the protocol.
   *
   * @return {MediaSequenceSync|null}
   * @private
   */


  var _proto = SegmentLoader.prototype;

  _proto.createTransmuxer_ = function createTransmuxer_() {
    return segmentTransmuxer.createTransmuxer({
      remux: false,
      alignGopsAtEnd: this.safeAppend_,
      keepOriginalTimestamps: true,
      parse708captions: this.parse708captions_,
      captionServices: this.captionServices_
    });
  }
  /**
   * reset all of our media stats
   *
   * @private
   */
  ;

  _proto.resetStats_ = function resetStats_() {
    this.mediaBytesTransferred = 0;
    this.mediaRequests = 0;
    this.mediaRequestsAborted = 0;
    this.mediaRequestsTimedout = 0;
    this.mediaRequestsErrored = 0;
    this.mediaTransferDuration = 0;
    this.mediaSecondsLoaded = 0;
    this.mediaAppends = 0;
  }
  /**
   * dispose of the SegmentLoader and reset to the default state
   */
  ;

  _proto.dispose = function dispose() {
    this.trigger('dispose');
    this.state = 'DISPOSED';
    this.pause();
    this.abort_();

    if (this.transmuxer_) {
      this.transmuxer_.terminate();
    }

    this.resetStats_();

    if (this.checkBufferTimeout_) {
      window$1.clearTimeout(this.checkBufferTimeout_);
    }

    if (this.syncController_ && this.triggerSyncInfoUpdate_) {
      this.syncController_.off('syncinfoupdate', this.triggerSyncInfoUpdate_);
    }

    this.off();
  };

  _proto.setAudio = function setAudio(enable) {
    this.audioDisabled_ = !enable;

    if (enable) {
      this.appendInitSegment_.audio = true;
    } else {
      // remove current track audio if it gets disabled
      this.sourceUpdater_.removeAudio(0, this.duration_());
    }
  }
  /**
   * abort anything that is currently doing on with the SegmentLoader
   * and reset to a default state
   */
  ;

  _proto.abort = function abort() {
    if (this.state !== 'WAITING') {
      if (this.pendingSegment_) {
        this.pendingSegment_ = null;
      }

      return;
    }

    this.abort_(); // We aborted the requests we were waiting on, so reset the loader's state to READY
    // since we are no longer "waiting" on any requests. XHR callback is not always run
    // when the request is aborted. This will prevent the loader from being stuck in the
    // WAITING state indefinitely.

    this.state = 'READY'; // don't wait for buffer check timeouts to begin fetching the
    // next segment

    if (!this.paused()) {
      this.monitorBuffer_();
    }
  }
  /**
   * abort all pending xhr requests and null any pending segements
   *
   * @private
   */
  ;

  _proto.abort_ = function abort_() {
    if (this.pendingSegment_ && this.pendingSegment_.abortRequests) {
      this.pendingSegment_.abortRequests();
    } // clear out the segment being processed


    this.pendingSegment_ = null;
    this.callQueue_ = [];
    this.loadQueue_ = [];
    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
    this.timelineChangeController_.clearPendingTimelineChange(this.loaderType_);
    this.waitingOnRemove_ = false;
    window$1.clearTimeout(this.quotaExceededErrorRetryTimeout_);
    this.quotaExceededErrorRetryTimeout_ = null;
  };

  _proto.checkForAbort_ = function checkForAbort_(requestId) {
    // If the state is APPENDING, then aborts will not modify the state, meaning the first
    // callback that happens should reset the state to READY so that loading can continue.
    if (this.state === 'APPENDING' && !this.pendingSegment_) {
      this.state = 'READY';
      return true;
    }

    if (!this.pendingSegment_ || this.pendingSegment_.requestId !== requestId) {
      return true;
    }

    return false;
  }
  /**
   * set an error on the segment loader and null out any pending segements
   *
   * @param {Error} error the error to set on the SegmentLoader
   * @return {Error} the error that was set or that is currently set
   */
  ;

  _proto.error = function error(_error) {
    if (typeof _error !== 'undefined') {
      this.logger_('error occurred:', _error);
      this.error_ = _error;
    }

    this.pendingSegment_ = null;
    return this.error_;
  };

  _proto.endOfStream = function endOfStream() {
    this.ended_ = true;

    if (this.transmuxer_) {
      // need to clear out any cached data to prepare for the new segment
      segmentTransmuxer.reset(this.transmuxer_);
    }

    this.gopBuffer_.length = 0;
    this.pause();
    this.trigger('ended');
  }
  /**
   * Indicates which time ranges are buffered
   *
   * @return {TimeRange}
   *         TimeRange object representing the current buffered ranges
   */
  ;

  _proto.buffered_ = function buffered_() {
    var trackInfo = this.getMediaInfo_();

    if (!this.sourceUpdater_ || !trackInfo) {
      return createTimeRanges();
    }

    if (this.loaderType_ === 'main') {
      var hasAudio = trackInfo.hasAudio,
          hasVideo = trackInfo.hasVideo,
          isMuxed = trackInfo.isMuxed;

      if (hasVideo && hasAudio && !this.audioDisabled_ && !isMuxed) {
        return this.sourceUpdater_.buffered();
      }

      if (hasVideo) {
        return this.sourceUpdater_.videoBuffered();
      }
    } // One case that can be ignored for now is audio only with alt audio,
    // as we don't yet have proper support for that.


    return this.sourceUpdater_.audioBuffered();
  }
  /**
   * Gets and sets init segment for the provided map
   *
   * @param {Object} map
   *        The map object representing the init segment to get or set
   * @param {boolean=} set
   *        If true, the init segment for the provided map should be saved
   * @return {Object}
   *         map object for desired init segment
   */
  ;

  _proto.initSegmentForMap = function initSegmentForMap(map, set) {
    if (set === void 0) {
      set = false;
    }

    if (!map) {
      return null;
    }

    var id = initSegmentId(map);
    var storedMap = this.initSegments_[id];

    if (set && !storedMap && map.bytes) {
      this.initSegments_[id] = storedMap = {
        resolvedUri: map.resolvedUri,
        byterange: map.byterange,
        bytes: map.bytes,
        tracks: map.tracks,
        timescales: map.timescales
      };
    }

    return storedMap || map;
  }
  /**
   * Gets and sets key for the provided key
   *
   * @param {Object} key
   *        The key object representing the key to get or set
   * @param {boolean=} set
   *        If true, the key for the provided key should be saved
   * @return {Object}
   *         Key object for desired key
   */
  ;

  _proto.segmentKey = function segmentKey(key, set) {
    if (set === void 0) {
      set = false;
    }

    if (!key) {
      return null;
    }

    var id = segmentKeyId(key);
    var storedKey = this.keyCache_[id]; // TODO: We should use the HTTP Expires header to invalidate our cache per
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-6.2.3

    if (this.cacheEncryptionKeys_ && set && !storedKey && key.bytes) {
      this.keyCache_[id] = storedKey = {
        resolvedUri: key.resolvedUri,
        bytes: key.bytes
      };
    }

    var result = {
      resolvedUri: (storedKey || key).resolvedUri
    };

    if (storedKey) {
      result.bytes = storedKey.bytes;
    }

    return result;
  }
  /**
   * Returns true if all configuration required for loading is present, otherwise false.
   *
   * @return {boolean} True if the all configuration is ready for loading
   * @private
   */
  ;

  _proto.couldBeginLoading_ = function couldBeginLoading_() {
    return this.playlist_ && !this.paused();
  }
  /**
   * load a playlist and start to fill the buffer
   */
  ;

  _proto.load = function load() {
    // un-pause
    this.monitorBuffer_(); // if we don't have a playlist yet, keep waiting for one to be
    // specified

    if (!this.playlist_) {
      return;
    } // if all the configuration is ready, initialize and begin loading


    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    } // if we're in the middle of processing a segment already, don't
    // kick off an additional segment request


    if (!this.couldBeginLoading_() || this.state !== 'READY' && this.state !== 'INIT') {
      return;
    }

    this.state = 'READY';
  }
  /**
   * Once all the starting parameters have been specified, begin
   * operation. This method should only be invoked from the INIT
   * state.
   *
   * @private
   */
  ;

  _proto.init_ = function init_() {
    this.state = 'READY'; // if this is the audio segment loader, and it hasn't been inited before, then any old
    // audio data from the muxed content should be removed

    this.resetEverything();
    return this.monitorBuffer_();
  }
  /**
   * set a playlist on the segment loader
   *
   * @param {PlaylistLoader} media the playlist to set on the segment loader
   */
  ;

  _proto.playlist = function playlist(newPlaylist, options) {
    if (options === void 0) {
      options = {};
    }

    if (!newPlaylist) {
      return;
    }

    var oldPlaylist = this.playlist_;
    var segmentInfo = this.pendingSegment_;
    this.playlist_ = newPlaylist;
    this.xhrOptions_ = options; // when we haven't started playing yet, the start of a live playlist
    // is always our zero-time so force a sync update each time the playlist
    // is refreshed from the server
    //
    // Use the INIT state to determine if playback has started, as the playlist sync info
    // should be fixed once requests begin (as sync points are generated based on sync
    // info), but not before then.

    if (this.state === 'INIT') {
      newPlaylist.syncInfo = {
        mediaSequence: newPlaylist.mediaSequence,
        time: 0
      }; // Setting the date time mapping means mapping the program date time (if available)
      // to time 0 on the player's timeline. The playlist's syncInfo serves a similar
      // purpose, mapping the initial mediaSequence to time zero. Since the syncInfo can
      // be updated as the playlist is refreshed before the loader starts loading, the
      // program date time mapping needs to be updated as well.
      //
      // This mapping is only done for the main loader because a program date time should
      // map equivalently between playlists.

      if (this.loaderType_ === 'main') {
        this.syncController_.setDateTimeMappingForStart(newPlaylist);
      }
    }

    var oldId = null;

    if (oldPlaylist) {
      if (oldPlaylist.id) {
        oldId = oldPlaylist.id;
      } else if (oldPlaylist.uri) {
        oldId = oldPlaylist.uri;
      }
    }

    this.logger_("playlist update [" + oldId + " => " + (newPlaylist.id || newPlaylist.uri) + "]");

    if (this.mediaSequenceSync_) {
      this.mediaSequenceSync_.update(newPlaylist, this.currentTime_());
      this.logger_("Playlist update:\ncurrentTime: " + this.currentTime_() + "\nbufferedEnd: " + lastBufferedEnd(this.buffered_()) + "\n", this.mediaSequenceSync_.diagnostics);
    } // in VOD, this is always a rendition switch (or we updated our syncInfo above)
    // in LIVE, we always want to update with new playlists (including refreshes)


    this.trigger('syncinfoupdate'); // if we were unpaused but waiting for a playlist, start
    // buffering now

    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    if (!oldPlaylist || oldPlaylist.uri !== newPlaylist.uri) {
      if (this.mediaIndex !== null) {
        // we must reset/resync the segment loader when we switch renditions and
        // the segment loader is already synced to the previous rendition
        // We only want to reset the loader here for LLHLS playback, as resetLoader sets fetchAtBuffer_
        // to false, resulting in fetching segments at currentTime and causing repeated
        // same-segment requests on playlist change. This erroneously drives up the playback watcher
        // stalled segment count, as re-requesting segments at the currentTime or browser cached segments
        // will not change the buffer.
        // Reference for LLHLS fixes: https://github.com/videojs/http-streaming/pull/1201
        var isLLHLS = !newPlaylist.endList && typeof newPlaylist.partTargetDuration === 'number';

        if (isLLHLS) {
          this.resetLoader();
        } else {
          this.resyncLoader();
        }
      }

      this.currentMediaInfo_ = void 0;
      this.trigger('playlistupdate'); // the rest of this function depends on `oldPlaylist` being defined

      return;
    } // we reloaded the same playlist so we are in a live scenario
    // and we will likely need to adjust the mediaIndex


    var mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;
    this.logger_("live window shift [" + mediaSequenceDiff + "]"); // update the mediaIndex on the SegmentLoader
    // this is important because we can abort a request and this value must be
    // equal to the last appended mediaIndex

    if (this.mediaIndex !== null) {
      this.mediaIndex -= mediaSequenceDiff; // this can happen if we are going to load the first segment, but get a playlist
      // update during that. mediaIndex would go from 0 to -1 if mediaSequence in the
      // new playlist was incremented by 1.

      if (this.mediaIndex < 0) {
        this.mediaIndex = null;
        this.partIndex = null;
      } else {
        var segment = this.playlist_.segments[this.mediaIndex]; // partIndex should remain the same for the same segment
        // unless parts fell off of the playlist for this segment.
        // In that case we need to reset partIndex and resync

        if (this.partIndex && (!segment.parts || !segment.parts.length || !segment.parts[this.partIndex])) {
          var mediaIndex = this.mediaIndex;
          this.logger_("currently processing part (index " + this.partIndex + ") no longer exists.");
          this.resetLoader(); // We want to throw away the partIndex and the data associated with it,
          // as the part was dropped from our current playlists segment.
          // The mediaIndex will still be valid so keep that around.

          this.mediaIndex = mediaIndex;
        }
      }
    } // update the mediaIndex on the SegmentInfo object
    // this is important because we will update this.mediaIndex with this value
    // in `handleAppendsDone_` after the segment has been successfully appended


    if (segmentInfo) {
      segmentInfo.mediaIndex -= mediaSequenceDiff;

      if (segmentInfo.mediaIndex < 0) {
        segmentInfo.mediaIndex = null;
        segmentInfo.partIndex = null;
      } else {
        // we need to update the referenced segment so that timing information is
        // saved for the new playlist's segment, however, if the segment fell off the
        // playlist, we can leave the old reference and just lose the timing info
        if (segmentInfo.mediaIndex >= 0) {
          segmentInfo.segment = newPlaylist.segments[segmentInfo.mediaIndex];
        }

        if (segmentInfo.partIndex >= 0 && segmentInfo.segment.parts) {
          segmentInfo.part = segmentInfo.segment.parts[segmentInfo.partIndex];
        }
      }
    }

    this.syncController_.saveExpiredSegmentInfo(oldPlaylist, newPlaylist);
  }
  /**
   * Prevent the loader from fetching additional segments. If there
   * is a segment request outstanding, it will finish processing
   * before the loader halts. A segment loader can be unpaused by
   * calling load().
   */
  ;

  _proto.pause = function pause() {
    if (this.checkBufferTimeout_) {
      window$1.clearTimeout(this.checkBufferTimeout_);
      this.checkBufferTimeout_ = null;
    }
  }
  /**
   * Returns whether the segment loader is fetching additional
   * segments when given the opportunity. This property can be
   * modified through calls to pause() and load().
   */
  ;

  _proto.paused = function paused() {
    return this.checkBufferTimeout_ === null;
  }
  /**
   * Delete all the buffered data and reset the SegmentLoader
   *
   * @param {Function} [done] an optional callback to be executed when the remove
   * operation is complete
   */
  ;

  _proto.resetEverything = function resetEverything(done) {
    this.ended_ = false;
    this.activeInitSegmentId_ = null;
    this.appendInitSegment_ = {
      audio: true,
      video: true
    };
    this.resetLoader(); // remove from 0, the earliest point, to Infinity, to signify removal of everything.
    // VTT Segment Loader doesn't need to do anything but in the regular SegmentLoader,
    // we then clamp the value to duration if necessary.

    this.remove(0, Infinity, done); // clears fmp4 captions

    if (this.transmuxer_) {
      this.transmuxer_.postMessage({
        action: 'clearAllMp4Captions'
      }); // reset the cache in the transmuxer

      this.transmuxer_.postMessage({
        action: 'reset'
      });
    }
  }
  /**
   * Force the SegmentLoader to resync and start loading around the currentTime instead
   * of starting at the end of the buffer
   *
   * Useful for fast quality changes
   */
  ;

  _proto.resetLoader = function resetLoader() {
    this.fetchAtBuffer_ = false;

    if (this.mediaSequenceSync_) {
      this.mediaSequenceSync_.resetAppendedStatus();
    }

    this.resyncLoader();
  }
  /**
   * Force the SegmentLoader to restart synchronization and make a conservative guess
   * before returning to the simple walk-forward method
   */
  ;

  _proto.resyncLoader = function resyncLoader() {
    if (this.transmuxer_) {
      // need to clear out any cached data to prepare for the new segment
      segmentTransmuxer.reset(this.transmuxer_);
    }

    this.mediaIndex = null;
    this.partIndex = null;
    this.syncPoint_ = null;
    this.isPendingTimestampOffset_ = false; // this is mainly to sync timing-info when switching between renditions with and without timestamp-rollover,
    // so we don't want it for DASH or fragmented mp4 segments.

    var isFmp4 = this.currentMediaInfo_ && this.currentMediaInfo_.isFmp4;
    var isHlsTs = this.sourceType_ === 'hls' && !isFmp4;

    if (isHlsTs) {
      this.shouldForceTimestampOffsetAfterResync_ = true;
    }

    this.callQueue_ = [];
    this.loadQueue_ = [];
    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
    this.abort();

    if (this.transmuxer_) {
      this.transmuxer_.postMessage({
        action: 'clearParsedMp4Captions'
      });
    }
  }
  /**
   * Remove any data in the source buffer between start and end times
   *
   * @param {number} start - the start time of the region to remove from the buffer
   * @param {number} end - the end time of the region to remove from the buffer
   * @param {Function} [done] - an optional callback to be executed when the remove
   * @param {boolean} force - force all remove operations to happen
   * operation is complete
   */
  ;

  _proto.remove = function remove(start, end, done, force) {
    if (done === void 0) {
      done = function done() {};
    }

    if (force === void 0) {
      force = false;
    }

    // clamp end to duration if we need to remove everything.
    // This is due to a browser bug that causes issues if we remove to Infinity.
    // videojs/videojs-contrib-hls#1225
    if (end === Infinity) {
      end = this.duration_();
    } // skip removes that would throw an error
    // commonly happens during a rendition switch at the start of a video
    // from start 0 to end 0


    if (end <= start) {
      this.logger_('skipping remove because end ${end} is <= start ${start}');
      return;
    }

    if (!this.sourceUpdater_ || !this.getMediaInfo_()) {
      this.logger_('skipping remove because no source updater or starting media info'); // nothing to remove if we haven't processed any media

      return;
    } // set it to one to complete this function's removes


    var removesRemaining = 1;

    var removeFinished = function removeFinished() {
      removesRemaining--;

      if (removesRemaining === 0) {
        done();
      }
    };

    if (force || !this.audioDisabled_) {
      removesRemaining++;
      this.sourceUpdater_.removeAudio(start, end, removeFinished);
    } // While it would be better to only remove video if the main loader has video, this
    // should be safe with audio only as removeVideo will call back even if there's no
    // video buffer.
    //
    // In theory we can check to see if there's video before calling the remove, but in
    // the event that we're switching between renditions and from video to audio only
    // (when we add support for that), we may need to clear the video contents despite
    // what the new media will contain.


    if (force || this.loaderType_ === 'main') {
      this.gopBuffer_ = removeGopBuffer(this.gopBuffer_, start, end, this.timeMapping_);
      removesRemaining++;
      this.sourceUpdater_.removeVideo(start, end, removeFinished);
    } // remove any captions and ID3 tags


    for (var track in this.inbandTextTracks_) {
      removeCuesFromTrack(start, end, this.inbandTextTracks_[track]);
    }

    removeCuesFromTrack(start, end, this.segmentMetadataTrack_); // finished this function's removes

    removeFinished();
  }
  /**
   * (re-)schedule monitorBufferTick_ to run as soon as possible
   *
   * @private
   */
  ;

  _proto.monitorBuffer_ = function monitorBuffer_() {
    if (this.checkBufferTimeout_) {
      window$1.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window$1.setTimeout(this.monitorBufferTick_.bind(this), 1);
  }
  /**
   * As long as the SegmentLoader is in the READY state, periodically
   * invoke fillBuffer_().
   *
   * @private
   */
  ;

  _proto.monitorBufferTick_ = function monitorBufferTick_() {
    if (this.state === 'READY') {
      this.fillBuffer_();
    }

    if (this.checkBufferTimeout_) {
      window$1.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window$1.setTimeout(this.monitorBufferTick_.bind(this), CHECK_BUFFER_DELAY);
  }
  /**
   * fill the buffer with segements unless the sourceBuffers are
   * currently updating
   *
   * Note: this function should only ever be called by monitorBuffer_
   * and never directly
   *
   * @private
   */
  ;

  _proto.fillBuffer_ = function fillBuffer_() {
    // TODO since the source buffer maintains a queue, and we shouldn't call this function
    // except when we're ready for the next segment, this check can most likely be removed
    if (this.sourceUpdater_.updating()) {
      return;
    } // see if we need to begin loading immediately


    var segmentInfo = this.chooseNextRequest_();

    if (!segmentInfo) {
      return;
    }

    if (typeof segmentInfo.timestampOffset === 'number') {
      this.isPendingTimestampOffset_ = false;
      this.timelineChangeController_.pendingTimelineChange({
        type: this.loaderType_,
        from: this.currentTimeline_,
        to: segmentInfo.timeline
      });
    }

    this.loadSegment_(segmentInfo);
  }
  /**
   * Determines if we should call endOfStream on the media source based
   * on the state of the buffer or if appened segment was the final
   * segment in the playlist.
   *
   * @param {number} [mediaIndex] the media index of segment we last appended
   * @param {Object} [playlist] a media playlist object
   * @return {boolean} do we need to call endOfStream on the MediaSource
   */
  ;

  _proto.isEndOfStream_ = function isEndOfStream_(mediaIndex, playlist, partIndex) {
    if (mediaIndex === void 0) {
      mediaIndex = this.mediaIndex;
    }

    if (playlist === void 0) {
      playlist = this.playlist_;
    }

    if (partIndex === void 0) {
      partIndex = this.partIndex;
    }

    if (!playlist || !this.mediaSource_) {
      return false;
    }

    var segment = typeof mediaIndex === 'number' && playlist.segments[mediaIndex]; // mediaIndex is zero based but length is 1 based

    var appendedLastSegment = mediaIndex + 1 === playlist.segments.length; // true if there are no parts, or this is the last part.

    var appendedLastPart = !segment || !segment.parts || partIndex + 1 === segment.parts.length; // if we've buffered to the end of the video, we need to call endOfStream
    // so that MediaSources can trigger the `ended` event when it runs out of
    // buffered data instead of waiting for me

    return playlist.endList && this.mediaSource_.readyState === 'open' && appendedLastSegment && appendedLastPart;
  }
  /**
   * Determines what request should be made given current segment loader state.
   *
   * @return {Object} a request object that describes the segment/part to load
   */
  ;

  _proto.chooseNextRequest_ = function chooseNextRequest_() {
    var buffered = this.buffered_();
    var bufferedEnd = lastBufferedEnd(buffered) || 0;
    var bufferedTime = timeAheadOf(buffered, this.currentTime_());
    var preloaded = !this.hasPlayed_() && bufferedTime >= 1;
    var haveEnoughBuffer = bufferedTime >= this.goalBufferLength_();
    var segments = this.playlist_.segments; // return no segment if:
    // 1. we don't have segments
    // 2. The video has not yet played and we already downloaded a segment
    // 3. we already have enough buffered time

    if (!segments.length || preloaded || haveEnoughBuffer) {
      return null;
    }

    this.syncPoint_ = this.syncPoint_ || this.syncController_.getSyncPoint(this.playlist_, this.duration_(), this.currentTimeline_, this.currentTime_(), this.loaderType_);
    var next = {
      partIndex: null,
      mediaIndex: null,
      startOfSegment: null,
      playlist: this.playlist_,
      isSyncRequest: Boolean(!this.syncPoint_)
    };

    if (next.isSyncRequest) {
      next.mediaIndex = getSyncSegmentCandidate(this.currentTimeline_, segments, bufferedEnd);
      this.logger_("choose next request. Can not find sync point. Fallback to media Index: " + next.mediaIndex);
    } else if (this.mediaIndex !== null) {
      var segment = segments[this.mediaIndex];
      var partIndex = typeof this.partIndex === 'number' ? this.partIndex : -1;
      next.startOfSegment = segment.end ? segment.end : bufferedEnd;

      if (segment.parts && segment.parts[partIndex + 1]) {
        next.mediaIndex = this.mediaIndex;
        next.partIndex = partIndex + 1;
      } else {
        next.mediaIndex = this.mediaIndex + 1;
      }
    } else {
      var segmentIndex;

      var _partIndex;

      var startTime;
      var targetTime = this.fetchAtBuffer_ ? bufferedEnd : this.currentTime_();

      if (this.mediaSequenceSync_) {
        this.logger_("chooseNextRequest_ request after Quality Switch:\nFor TargetTime: " + targetTime + ".\nCurrentTime: " + this.currentTime_() + "\nBufferedEnd: " + bufferedEnd + "\nFetch At Buffer: " + this.fetchAtBuffer_ + "\n", this.mediaSequenceSync_.diagnostics);
      }

      if (this.mediaSequenceSync_ && this.mediaSequenceSync_.isReliable) {
        var syncInfo = this.getSyncInfoFromMediaSequenceSync_(targetTime);

        if (!syncInfo) {
          this.logger_('chooseNextRequest_ - no sync info found using media sequence sync'); // no match

          return null;
        }

        this.logger_("chooseNextRequest_ mediaSequence syncInfo (" + syncInfo.start + " --> " + syncInfo.end + ")");
        segmentIndex = syncInfo.segmentIndex;
        _partIndex = syncInfo.partIndex;
        startTime = syncInfo.start;
      } else {
        this.logger_('chooseNextRequest_ - fallback to a regular segment selection algorithm, based on a syncPoint.'); // fallback

        var mediaInfoForTime = Playlist.getMediaInfoForTime({
          exactManifestTimings: this.exactManifestTimings,
          playlist: this.playlist_,
          currentTime: targetTime,
          startingPartIndex: this.syncPoint_.partIndex,
          startingSegmentIndex: this.syncPoint_.segmentIndex,
          startTime: this.syncPoint_.time
        });
        segmentIndex = mediaInfoForTime.segmentIndex;
        _partIndex = mediaInfoForTime.partIndex;
        startTime = mediaInfoForTime.startTime;
      }

      next.getMediaInfoForTime = this.fetchAtBuffer_ ? "bufferedEnd " + targetTime : "currentTime " + targetTime;
      next.mediaIndex = segmentIndex;
      next.startOfSegment = startTime;
      next.partIndex = _partIndex;
      this.logger_("choose next request. Playlist switched and we have a sync point. Media Index: " + next.mediaIndex + " ");
    }

    var nextSegment = segments[next.mediaIndex];
    var nextPart = nextSegment && typeof next.partIndex === 'number' && nextSegment.parts && nextSegment.parts[next.partIndex]; // if the next segment index is invalid or
    // the next partIndex is invalid do not choose a next segment.

    if (!nextSegment || typeof next.partIndex === 'number' && !nextPart) {
      return null;
    } // if the next segment has parts, and we don't have a partIndex.
    // Set partIndex to 0


    if (typeof next.partIndex !== 'number' && nextSegment.parts) {
      next.partIndex = 0;
      nextPart = nextSegment.parts[0];
    } // independentSegments applies to every segment in a playlist. If independentSegments appears in a main playlist,
    // it applies to each segment in each media playlist.
    // https://datatracker.ietf.org/doc/html/draft-pantos-http-live-streaming-23#section-4.3.5.1


    var hasIndependentSegments = this.vhs_.playlists && this.vhs_.playlists.main && this.vhs_.playlists.main.independentSegments || this.playlist_.independentSegments; // if we have no buffered data then we need to make sure
    // that the next part we append is "independent" if possible.
    // So we check if the previous part is independent, and request
    // it if it is.

    if (!bufferedTime && nextPart && !hasIndependentSegments && !nextPart.independent) {
      if (next.partIndex === 0) {
        var lastSegment = segments[next.mediaIndex - 1];
        var lastSegmentLastPart = lastSegment.parts && lastSegment.parts.length && lastSegment.parts[lastSegment.parts.length - 1];

        if (lastSegmentLastPart && lastSegmentLastPart.independent) {
          next.mediaIndex -= 1;
          next.partIndex = lastSegment.parts.length - 1;
          next.independent = 'previous segment';
        }
      } else if (nextSegment.parts[next.partIndex - 1].independent) {
        next.partIndex -= 1;
        next.independent = 'previous part';
      }
    }

    var ended = this.mediaSource_ && this.mediaSource_.readyState === 'ended'; // do not choose a next segment if all of the following:
    // 1. this is the last segment in the playlist
    // 2. end of stream has been called on the media source already
    // 3. the player is not seeking

    if (next.mediaIndex >= segments.length - 1 && ended && !this.seeking_()) {
      return null;
    }

    if (this.shouldForceTimestampOffsetAfterResync_) {
      this.shouldForceTimestampOffsetAfterResync_ = false;
      next.forceTimestampOffset = true;
      this.logger_('choose next request. Force timestamp offset after loader resync');
    }

    return this.generateSegmentInfo_(next);
  };

  _proto.getSyncInfoFromMediaSequenceSync_ = function getSyncInfoFromMediaSequenceSync_(targetTime) {
    if (!this.mediaSequenceSync_) {
      return null;
    } // we should pull the target time to the least available time if we drop out of sync for any reason


    var finalTargetTime = Math.max(targetTime, this.mediaSequenceSync_.start);

    if (targetTime !== finalTargetTime) {
      this.logger_("getSyncInfoFromMediaSequenceSync_. Pulled target time from " + targetTime + " to " + finalTargetTime);
    }

    var mediaSequenceSyncInfo = this.mediaSequenceSync_.getSyncInfoForTime(finalTargetTime);

    if (!mediaSequenceSyncInfo) {
      // no match at all
      return null;
    }

    if (!mediaSequenceSyncInfo.isAppended) {
      // has a perfect match
      return mediaSequenceSyncInfo;
    } // has match, but segment was already appended.
    // attempt to auto-advance to the nearest next segment:


    var nextMediaSequenceSyncInfo = this.mediaSequenceSync_.getSyncInfoForTime(mediaSequenceSyncInfo.end);

    if (!nextMediaSequenceSyncInfo) {
      // no match at all
      return null;
    }

    if (nextMediaSequenceSyncInfo.isAppended) {
      this.logger_('getSyncInfoFromMediaSequenceSync_: We encounter unexpected scenario where next media sequence sync info is also appended!');
    } // got match with the nearest next segment


    return nextMediaSequenceSyncInfo;
  };

  _proto.generateSegmentInfo_ = function generateSegmentInfo_(options) {
    var independent = options.independent,
        playlist = options.playlist,
        mediaIndex = options.mediaIndex,
        startOfSegment = options.startOfSegment,
        isSyncRequest = options.isSyncRequest,
        partIndex = options.partIndex,
        forceTimestampOffset = options.forceTimestampOffset,
        getMediaInfoForTime = options.getMediaInfoForTime;
    var segment = playlist.segments[mediaIndex];
    var part = typeof partIndex === 'number' && segment.parts[partIndex];
    var segmentInfo = {
      requestId: 'segment-loader-' + Math.random(),
      // resolve the segment URL relative to the playlist
      uri: part && part.resolvedUri || segment.resolvedUri,
      // the segment's mediaIndex at the time it was requested
      mediaIndex: mediaIndex,
      partIndex: part ? partIndex : null,
      // whether or not to update the SegmentLoader's state with this
      // segment's mediaIndex
      isSyncRequest: isSyncRequest,
      startOfSegment: startOfSegment,
      // the segment's playlist
      playlist: playlist,
      // unencrypted bytes of the segment
      bytes: null,
      // when a key is defined for this segment, the encrypted bytes
      encryptedBytes: null,
      // The target timestampOffset for this segment when we append it
      // to the source buffer
      timestampOffset: null,
      // The timeline that the segment is in
      timeline: segment.timeline,
      // The expected duration of the segment in seconds
      duration: part && part.duration || segment.duration,
      // retain the segment in case the playlist updates while doing an async process
      segment: segment,
      part: part,
      byteLength: 0,
      transmuxer: this.transmuxer_,
      // type of getMediaInfoForTime that was used to get this segment
      getMediaInfoForTime: getMediaInfoForTime,
      independent: independent
    };
    var overrideCheck = typeof forceTimestampOffset !== 'undefined' ? forceTimestampOffset : this.isPendingTimestampOffset_;
    segmentInfo.timestampOffset = this.timestampOffsetForSegment_({
      segmentTimeline: segment.timeline,
      currentTimeline: this.currentTimeline_,
      startOfSegment: startOfSegment,
      buffered: this.buffered_(),
      overrideCheck: overrideCheck
    });
    var audioBufferedEnd = lastBufferedEnd(this.sourceUpdater_.audioBuffered());

    if (typeof audioBufferedEnd === 'number') {
      // since the transmuxer is using the actual timing values, but the buffer is
      // adjusted by the timestamp offset, we must adjust the value here
      segmentInfo.audioAppendStart = audioBufferedEnd - this.sourceUpdater_.audioTimestampOffset();
    }

    if (this.sourceUpdater_.videoBuffered().length) {
      segmentInfo.gopsToAlignWith = gopsSafeToAlignWith(this.gopBuffer_, // since the transmuxer is using the actual timing values, but the time is
      // adjusted by the timestmap offset, we must adjust the value here
      this.currentTime_() - this.sourceUpdater_.videoTimestampOffset(), this.timeMapping_);
    }

    return segmentInfo;
  } // get the timestampoffset for a segment,
  // added so that vtt segment loader can override and prevent
  // adding timestamp offsets.
  ;

  _proto.timestampOffsetForSegment_ = function timestampOffsetForSegment_(options) {
    return timestampOffsetForSegment(options);
  }
  /**
   * Determines if the network has enough bandwidth to complete the current segment
   * request in a timely manner. If not, the request will be aborted early and bandwidth
   * updated to trigger a playlist switch.
   *
   * @param {Object} stats
   *        Object containing stats about the request timing and size
   * @private
   */
  ;

  _proto.earlyAbortWhenNeeded_ = function earlyAbortWhenNeeded_(stats) {
    if (this.vhs_.tech_.paused() || // Don't abort if the current playlist is on the lowestEnabledRendition
    // TODO: Replace using timeout with a boolean indicating whether this playlist is
    //       the lowestEnabledRendition.
    !this.xhrOptions_.timeout || // Don't abort if we have no bandwidth information to estimate segment sizes
    !this.playlist_.attributes.BANDWIDTH) {
      return;
    } // Wait at least 1 second since the first byte of data has been received before
    // using the calculated bandwidth from the progress event to allow the bitrate
    // to stabilize


    if (Date.now() - (stats.firstBytesReceivedAt || Date.now()) < 1000) {
      return;
    }

    var currentTime = this.currentTime_();
    var measuredBandwidth = stats.bandwidth;
    var segmentDuration = this.pendingSegment_.duration;
    var requestTimeRemaining = Playlist.estimateSegmentRequestTime(segmentDuration, measuredBandwidth, this.playlist_, stats.bytesReceived); // Subtract 1 from the timeUntilRebuffer so we still consider an early abort
    // if we are only left with less than 1 second when the request completes.
    // A negative timeUntilRebuffering indicates we are already rebuffering

    var timeUntilRebuffer$1 = timeUntilRebuffer(this.buffered_(), currentTime, this.vhs_.tech_.playbackRate()) - 1; // Only consider aborting early if the estimated time to finish the download
    // is larger than the estimated time until the player runs out of forward buffer

    if (requestTimeRemaining <= timeUntilRebuffer$1) {
      return;
    }

    var switchCandidate = minRebufferMaxBandwidthSelector({
      main: this.vhs_.playlists.main,
      currentTime: currentTime,
      bandwidth: measuredBandwidth,
      duration: this.duration_(),
      segmentDuration: segmentDuration,
      timeUntilRebuffer: timeUntilRebuffer$1,
      currentTimeline: this.currentTimeline_,
      syncController: this.syncController_
    });

    if (!switchCandidate) {
      return;
    }

    var rebufferingImpact = requestTimeRemaining - timeUntilRebuffer$1;
    var timeSavedBySwitching = rebufferingImpact - switchCandidate.rebufferingImpact;
    var minimumTimeSaving = 0.5; // If we are already rebuffering, increase the amount of variance we add to the
    // potential round trip time of the new request so that we are not too aggressive
    // with switching to a playlist that might save us a fraction of a second.

    if (timeUntilRebuffer$1 <= TIME_FUDGE_FACTOR) {
      minimumTimeSaving = 1;
    }

    if (!switchCandidate.playlist || switchCandidate.playlist.uri === this.playlist_.uri || timeSavedBySwitching < minimumTimeSaving) {
      return;
    } // set the bandwidth to that of the desired playlist being sure to scale by
    // BANDWIDTH_VARIANCE and add one so the playlist selector does not exclude it
    // don't trigger a bandwidthupdate as the bandwidth is artifial


    this.bandwidth = switchCandidate.playlist.attributes.BANDWIDTH * Config.BANDWIDTH_VARIANCE + 1;
    this.trigger('earlyabort');
  };

  _proto.handleAbort_ = function handleAbort_(segmentInfo) {
    this.logger_("Aborting " + segmentInfoString(segmentInfo));
    this.mediaRequestsAborted += 1;
  }
  /**
   * XHR `progress` event handler
   *
   * @param {Event}
   *        The XHR `progress` event
   * @param {Object} simpleSegment
   *        A simplified segment object copy
   * @private
   */
  ;

  _proto.handleProgress_ = function handleProgress_(event, simpleSegment) {
    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    }

    this.trigger('progress');
  };

  _proto.handleTrackInfo_ = function handleTrackInfo_(simpleSegment, trackInfo) {
    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    }

    if (this.checkForIllegalMediaSwitch(trackInfo)) {
      return;
    }

    trackInfo = trackInfo || {}; // When we have track info, determine what media types this loader is dealing with.
    // Guard against cases where we're not getting track info at all until we are
    // certain that all streams will provide it.

    if (!shallowEqual(this.currentMediaInfo_, trackInfo)) {
      this.appendInitSegment_ = {
        audio: true,
        video: true
      };
      this.startingMediaInfo_ = trackInfo;
      this.currentMediaInfo_ = trackInfo;
      this.logger_('trackinfo update', trackInfo);
      this.trigger('trackinfo');
    } // trackinfo may cause an abort if the trackinfo
    // causes a codec change to an unsupported codec.


    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    } // set trackinfo on the pending segment so that
    // it can append.


    this.pendingSegment_.trackInfo = trackInfo; // check if any calls were waiting on the track info

    if (this.hasEnoughInfoToAppend_()) {
      this.processCallQueue_();
    }
  };

  _proto.handleTimingInfo_ = function handleTimingInfo_(simpleSegment, mediaType, timeType, time) {
    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    }

    var segmentInfo = this.pendingSegment_;
    var timingInfoProperty = timingInfoPropertyForMedia(mediaType);
    segmentInfo[timingInfoProperty] = segmentInfo[timingInfoProperty] || {};
    segmentInfo[timingInfoProperty][timeType] = time;
    this.logger_("timinginfo: " + mediaType + " - " + timeType + " - " + time); // check if any calls were waiting on the timing info

    if (this.hasEnoughInfoToAppend_()) {
      this.processCallQueue_();
    }
  };

  _proto.handleCaptions_ = function handleCaptions_(simpleSegment, captionData) {
    var _this2 = this;

    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    } // This could only happen with fmp4 segments, but
    // should still not happen in general


    if (captionData.length === 0) {
      this.logger_('SegmentLoader received no captions from a caption event');
      return;
    }

    var segmentInfo = this.pendingSegment_; // Wait until we have some video data so that caption timing
    // can be adjusted by the timestamp offset

    if (!segmentInfo.hasAppendedData_) {
      this.metadataQueue_.caption.push(this.handleCaptions_.bind(this, simpleSegment, captionData));
      return;
    }

    var timestampOffset = this.sourceUpdater_.videoTimestampOffset() === null ? this.sourceUpdater_.audioTimestampOffset() : this.sourceUpdater_.videoTimestampOffset();
    var captionTracks = {}; // get total start/end and captions for each track/stream

    captionData.forEach(function (caption) {
      // caption.stream is actually a track name...
      // set to the existing values in tracks or default values
      captionTracks[caption.stream] = captionTracks[caption.stream] || {
        // Infinity, as any other value will be less than this
        startTime: Infinity,
        captions: [],
        // 0 as an other value will be more than this
        endTime: 0
      };
      var captionTrack = captionTracks[caption.stream];
      captionTrack.startTime = Math.min(captionTrack.startTime, caption.startTime + timestampOffset);
      captionTrack.endTime = Math.max(captionTrack.endTime, caption.endTime + timestampOffset);
      captionTrack.captions.push(caption);
    });
    Object.keys(captionTracks).forEach(function (trackName) {
      var _captionTracks$trackN = captionTracks[trackName],
          startTime = _captionTracks$trackN.startTime,
          endTime = _captionTracks$trackN.endTime,
          captions = _captionTracks$trackN.captions;
      var inbandTextTracks = _this2.inbandTextTracks_;

      _this2.logger_("adding cues from " + startTime + " -> " + endTime + " for " + trackName);

      createCaptionsTrackIfNotExists(inbandTextTracks, _this2.vhs_.tech_, trackName); // clear out any cues that start and end at the same time period for the same track.
      // We do this because a rendition change that also changes the timescale for captions
      // will result in captions being re-parsed for certain segments. If we add them again
      // without clearing we will have two of the same captions visible.

      removeCuesFromTrack(startTime, endTime, inbandTextTracks[trackName]);
      addCaptionData({
        captionArray: captions,
        inbandTextTracks: inbandTextTracks,
        timestampOffset: timestampOffset
      });
    }); // Reset stored captions since we added parsed
    // captions to a text track at this point

    if (this.transmuxer_) {
      this.transmuxer_.postMessage({
        action: 'clearParsedMp4Captions'
      });
    }
  };

  _proto.handleId3_ = function handleId3_(simpleSegment, id3Frames, dispatchType) {
    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    }

    var segmentInfo = this.pendingSegment_; // we need to have appended data in order for the timestamp offset to be set

    if (!segmentInfo.hasAppendedData_) {
      this.metadataQueue_.id3.push(this.handleId3_.bind(this, simpleSegment, id3Frames, dispatchType));
      return;
    }

    this.addMetadataToTextTrack(dispatchType, id3Frames, this.duration_());
  };

  _proto.processMetadataQueue_ = function processMetadataQueue_() {
    this.metadataQueue_.id3.forEach(function (fn) {
      return fn();
    });
    this.metadataQueue_.caption.forEach(function (fn) {
      return fn();
    });
    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
  };

  _proto.processCallQueue_ = function processCallQueue_() {
    var callQueue = this.callQueue_; // Clear out the queue before the queued functions are run, since some of the
    // functions may check the length of the load queue and default to pushing themselves
    // back onto the queue.

    this.callQueue_ = [];
    callQueue.forEach(function (fun) {
      return fun();
    });
  };

  _proto.processLoadQueue_ = function processLoadQueue_() {
    var loadQueue = this.loadQueue_; // Clear out the queue before the queued functions are run, since some of the
    // functions may check the length of the load queue and default to pushing themselves
    // back onto the queue.

    this.loadQueue_ = [];
    loadQueue.forEach(function (fun) {
      return fun();
    });
  }
  /**
   * Determines whether the loader has enough info to load the next segment.
   *
   * @return {boolean}
   *         Whether or not the loader has enough info to load the next segment
   */
  ;

  _proto.hasEnoughInfoToLoad_ = function hasEnoughInfoToLoad_() {
    // Since primary timing goes by video, only the audio loader potentially needs to wait
    // to load.
    if (this.loaderType_ !== 'audio') {
      return true;
    }

    var segmentInfo = this.pendingSegment_; // A fill buffer must have already run to establish a pending segment before there's
    // enough info to load.

    if (!segmentInfo) {
      return false;
    } // The first segment can and should be loaded immediately so that source buffers are
    // created together (before appending). Source buffer creation uses the presence of
    // audio and video data to determine whether to create audio/video source buffers, and
    // uses processed (transmuxed or parsed) media to determine the types required.


    if (!this.getCurrentMediaInfo_()) {
      return true;
    }

    if ( // Technically, instead of waiting to load a segment on timeline changes, a segment
    // can be requested and downloaded and only wait before it is transmuxed or parsed.
    // But in practice, there are a few reasons why it is better to wait until a loader
    // is ready to append that segment before requesting and downloading:
    //
    // 1. Because audio and main loaders cross discontinuities together, if this loader
    //    is waiting for the other to catch up, then instead of requesting another
    //    segment and using up more bandwidth, by not yet loading, more bandwidth is
    //    allotted to the loader currently behind.
    // 2. media-segment-request doesn't have to have logic to consider whether a segment
    // is ready to be processed or not, isolating the queueing behavior to the loader.
    // 3. The audio loader bases some of its segment properties on timing information
    //    provided by the main loader, meaning that, if the logic for waiting on
    //    processing was in media-segment-request, then it would also need to know how
    //    to re-generate the segment information after the main loader caught up.
    shouldWaitForTimelineChange({
      timelineChangeController: this.timelineChangeController_,
      currentTimeline: this.currentTimeline_,
      segmentTimeline: segmentInfo.timeline,
      loaderType: this.loaderType_,
      audioDisabled: this.audioDisabled_
    })) {
      return false;
    }

    return true;
  };

  _proto.getCurrentMediaInfo_ = function getCurrentMediaInfo_(segmentInfo) {
    if (segmentInfo === void 0) {
      segmentInfo = this.pendingSegment_;
    }

    return segmentInfo && segmentInfo.trackInfo || this.currentMediaInfo_;
  };

  _proto.getMediaInfo_ = function getMediaInfo_(segmentInfo) {
    if (segmentInfo === void 0) {
      segmentInfo = this.pendingSegment_;
    }

    return this.getCurrentMediaInfo_(segmentInfo) || this.startingMediaInfo_;
  };

  _proto.getPendingSegmentPlaylist = function getPendingSegmentPlaylist() {
    return this.pendingSegment_ ? this.pendingSegment_.playlist : null;
  };

  _proto.hasEnoughInfoToAppend_ = function hasEnoughInfoToAppend_() {
    if (!this.sourceUpdater_.ready()) {
      return false;
    } // If content needs to be removed or the loader is waiting on an append reattempt,
    // then no additional content should be appended until the prior append is resolved.


    if (this.waitingOnRemove_ || this.quotaExceededErrorRetryTimeout_) {
      return false;
    }

    var segmentInfo = this.pendingSegment_;
    var trackInfo = this.getCurrentMediaInfo_(); // no segment to append any data for or
    // we do not have information on this specific
    // segment yet

    if (!segmentInfo || !trackInfo) {
      return false;
    }

    var hasAudio = trackInfo.hasAudio,
        hasVideo = trackInfo.hasVideo,
        isMuxed = trackInfo.isMuxed;

    if (hasVideo && !segmentInfo.videoTimingInfo) {
      return false;
    } // muxed content only relies on video timing information for now.


    if (hasAudio && !this.audioDisabled_ && !isMuxed && !segmentInfo.audioTimingInfo) {
      return false;
    }

    if (shouldWaitForTimelineChange({
      timelineChangeController: this.timelineChangeController_,
      currentTimeline: this.currentTimeline_,
      segmentTimeline: segmentInfo.timeline,
      loaderType: this.loaderType_,
      audioDisabled: this.audioDisabled_
    })) {
      return false;
    }

    return true;
  };

  _proto.handleData_ = function handleData_(simpleSegment, result) {
    this.earlyAbortWhenNeeded_(simpleSegment.stats);

    if (this.checkForAbort_(simpleSegment.requestId)) {
      return;
    } // If there's anything in the call queue, then this data came later and should be
    // executed after the calls currently queued.


    if (this.callQueue_.length || !this.hasEnoughInfoToAppend_()) {
      this.callQueue_.push(this.handleData_.bind(this, simpleSegment, result));
      return;
    }

    var segmentInfo = this.pendingSegment_; // update the time mapping so we can translate from display time to media time

    this.setTimeMapping_(segmentInfo.timeline); // for tracking overall stats

    this.updateMediaSecondsLoaded_(segmentInfo.part || segmentInfo.segment); // Note that the state isn't changed from loading to appending. This is because abort
    // logic may change behavior depending on the state, and changing state too early may
    // inflate our estimates of bandwidth. In the future this should be re-examined to
    // note more granular states.
    // don't process and append data if the mediaSource is closed

    if (this.mediaSource_.readyState === 'closed') {
      return;
    } // if this request included an initialization segment, save that data
    // to the initSegment cache


    if (simpleSegment.map) {
      simpleSegment.map = this.initSegmentForMap(simpleSegment.map, true); // move over init segment properties to media request

      segmentInfo.segment.map = simpleSegment.map;
    } // if this request included a segment key, save that data in the cache


    if (simpleSegment.key) {
      this.segmentKey(simpleSegment.key, true);
    }

    segmentInfo.isFmp4 = simpleSegment.isFmp4;
    segmentInfo.timingInfo = segmentInfo.timingInfo || {};

    if (segmentInfo.isFmp4) {
      this.trigger('fmp4');
      segmentInfo.timingInfo.start = segmentInfo[timingInfoPropertyForMedia(result.type)].start;
    } else {
      var trackInfo = this.getCurrentMediaInfo_();
      var useVideoTimingInfo = this.loaderType_ === 'main' && trackInfo && trackInfo.hasVideo;
      var firstVideoFrameTimeForData;

      if (useVideoTimingInfo) {
        firstVideoFrameTimeForData = segmentInfo.videoTimingInfo.start;
      } // Segment loader knows more about segment timing than the transmuxer (in certain
      // aspects), so make any changes required for a more accurate start time.
      // Don't set the end time yet, as the segment may not be finished processing.


      segmentInfo.timingInfo.start = this.trueSegmentStart_({
        currentStart: segmentInfo.timingInfo.start,
        playlist: segmentInfo.playlist,
        mediaIndex: segmentInfo.mediaIndex,
        currentVideoTimestampOffset: this.sourceUpdater_.videoTimestampOffset(),
        useVideoTimingInfo: useVideoTimingInfo,
        firstVideoFrameTimeForData: firstVideoFrameTimeForData,
        videoTimingInfo: segmentInfo.videoTimingInfo,
        audioTimingInfo: segmentInfo.audioTimingInfo
      });
    } // Init segments for audio and video only need to be appended in certain cases. Now
    // that data is about to be appended, we can check the final cases to determine
    // whether we should append an init segment.


    this.updateAppendInitSegmentStatus(segmentInfo, result.type); // Timestamp offset should be updated once we get new data and have its timing info,
    // as we use the start of the segment to offset the best guess (playlist provided)
    // timestamp offset.

    this.updateSourceBufferTimestampOffset_(segmentInfo); // if this is a sync request we need to determine whether it should
    // be appended or not.

    if (segmentInfo.isSyncRequest) {
      // first save/update our timing info for this segment.
      // this is what allows us to choose an accurate segment
      // and the main reason we make a sync request.
      this.updateTimingInfoEnd_(segmentInfo);
      this.syncController_.saveSegmentTimingInfo({
        segmentInfo: segmentInfo,
        shouldSaveTimelineMapping: this.loaderType_ === 'main'
      });
      var next = this.chooseNextRequest_(); // If the sync request isn't the segment that would be requested next
      // after taking into account its timing info, do not append it.

      if (next.mediaIndex !== segmentInfo.mediaIndex || next.partIndex !== segmentInfo.partIndex) {
        this.logger_('sync segment was incorrect, not appending');
        return;
      } // otherwise append it like any other segment as our guess was correct.


      this.logger_('sync segment was correct, appending');
    } // Save some state so that in the future anything waiting on first append (and/or
    // timestamp offset(s)) can process immediately. While the extra state isn't optimal,
    // we need some notion of whether the timestamp offset or other relevant information
    // has had a chance to be set.


    segmentInfo.hasAppendedData_ = true; // Now that the timestamp offset should be set, we can append any waiting ID3 tags.

    this.processMetadataQueue_();
    this.appendData_(segmentInfo, result);
  };

  _proto.updateAppendInitSegmentStatus = function updateAppendInitSegmentStatus(segmentInfo, type) {
    // alt audio doesn't manage timestamp offset
    if (this.loaderType_ === 'main' && typeof segmentInfo.timestampOffset === 'number' && // in the case that we're handling partial data, we don't want to append an init
    // segment for each chunk
    !segmentInfo.changedTimestampOffset) {
      // if the timestamp offset changed, the timeline may have changed, so we have to re-
      // append init segments
      this.appendInitSegment_ = {
        audio: true,
        video: true
      };
    }

    if (this.playlistOfLastInitSegment_[type] !== segmentInfo.playlist) {
      // make sure we append init segment on playlist changes, in case the media config
      // changed
      this.appendInitSegment_[type] = true;
    }
  };

  _proto.getInitSegmentAndUpdateState_ = function getInitSegmentAndUpdateState_(_ref4) {
    var type = _ref4.type,
        initSegment = _ref4.initSegment,
        map = _ref4.map,
        playlist = _ref4.playlist;

    // "The EXT-X-MAP tag specifies how to obtain the Media Initialization Section
    // (Section 3) required to parse the applicable Media Segments.  It applies to every
    // Media Segment that appears after it in the Playlist until the next EXT-X-MAP tag
    // or until the end of the playlist."
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.2.5
    if (map) {
      var id = initSegmentId(map);

      if (this.activeInitSegmentId_ === id) {
        // don't need to re-append the init segment if the ID matches
        return null;
      } // a map-specified init segment takes priority over any transmuxed (or otherwise
      // obtained) init segment
      //
      // this also caches the init segment for later use


      initSegment = this.initSegmentForMap(map, true).bytes;
      this.activeInitSegmentId_ = id;
    } // We used to always prepend init segments for video, however, that shouldn't be
    // necessary. Instead, we should only append on changes, similar to what we've always
    // done for audio. This is more important (though may not be that important) for
    // frame-by-frame appending for LHLS, simply because of the increased quantity of
    // appends.


    if (initSegment && this.appendInitSegment_[type]) {
      // Make sure we track the playlist that we last used for the init segment, so that
      // we can re-append the init segment in the event that we get data from a new
      // playlist. Discontinuities and track changes are handled in other sections.
      this.playlistOfLastInitSegment_[type] = playlist; // Disable future init segment appends for this type. Until a change is necessary.

      this.appendInitSegment_[type] = false; // we need to clear out the fmp4 active init segment id, since
      // we are appending the muxer init segment

      this.activeInitSegmentId_ = null;
      return initSegment;
    }

    return null;
  };

  _proto.handleQuotaExceededError_ = function handleQuotaExceededError_(_ref5, error) {
    var _this3 = this;

    var segmentInfo = _ref5.segmentInfo,
        type = _ref5.type,
        bytes = _ref5.bytes;
    var audioBuffered = this.sourceUpdater_.audioBuffered();
    var videoBuffered = this.sourceUpdater_.videoBuffered(); // For now we're ignoring any notion of gaps in the buffer, but they, in theory,
    // should be cleared out during the buffer removals. However, log in case it helps
    // debug.

    if (audioBuffered.length > 1) {
      this.logger_('On QUOTA_EXCEEDED_ERR, found gaps in the audio buffer: ' + timeRangesToArray(audioBuffered).join(', '));
    }

    if (videoBuffered.length > 1) {
      this.logger_('On QUOTA_EXCEEDED_ERR, found gaps in the video buffer: ' + timeRangesToArray(videoBuffered).join(', '));
    }

    var audioBufferStart = audioBuffered.length ? audioBuffered.start(0) : 0;
    var audioBufferEnd = audioBuffered.length ? audioBuffered.end(audioBuffered.length - 1) : 0;
    var videoBufferStart = videoBuffered.length ? videoBuffered.start(0) : 0;
    var videoBufferEnd = videoBuffered.length ? videoBuffered.end(videoBuffered.length - 1) : 0;

    if (audioBufferEnd - audioBufferStart <= MIN_BACK_BUFFER && videoBufferEnd - videoBufferStart <= MIN_BACK_BUFFER) {
      // Can't remove enough buffer to make room for new segment (or the browser doesn't
      // allow for appends of segments this size). In the future, it may be possible to
      // split up the segment and append in pieces, but for now, error out this playlist
      // in an attempt to switch to a more manageable rendition.
      this.logger_('On QUOTA_EXCEEDED_ERR, single segment too large to append to ' + 'buffer, triggering an error. ' + ("Appended byte length: " + bytes.byteLength + ", ") + ("audio buffer: " + timeRangesToArray(audioBuffered).join(', ') + ", ") + ("video buffer: " + timeRangesToArray(videoBuffered).join(', ') + ", "));
      this.error({
        message: 'Quota exceeded error with append of a single segment of content',
        excludeUntil: Infinity,
        metadata: {
          errorType: videojs.Error.SegmentExceedsSourceBufferQuota
        }
      });
      this.trigger('error');
      return;
    } // To try to resolve the quota exceeded error, clear back buffer and retry. This means
    // that the segment-loader should block on future events until this one is handled, so
    // that it doesn't keep moving onto further segments. Adding the call to the call
    // queue will prevent further appends until waitingOnRemove_ and
    // quotaExceededErrorRetryTimeout_ are cleared.
    //
    // Note that this will only block the current loader. In the case of demuxed content,
    // the other load may keep filling as fast as possible. In practice, this should be
    // OK, as it is a rare case when either audio has a high enough bitrate to fill up a
    // source buffer, or video fills without enough room for audio to append (and without
    // the availability of clearing out seconds of back buffer to make room for audio).
    // But it might still be good to handle this case in the future as a TODO.


    this.waitingOnRemove_ = true;
    this.callQueue_.push(this.appendToSourceBuffer_.bind(this, {
      segmentInfo: segmentInfo,
      type: type,
      bytes: bytes
    }));
    var currentTime = this.currentTime_(); // Try to remove as much audio and video as possible to make room for new content
    // before retrying.

    var timeToRemoveUntil = currentTime - MIN_BACK_BUFFER;
    this.logger_("On QUOTA_EXCEEDED_ERR, removing audio/video from 0 to " + timeToRemoveUntil);
    this.remove(0, timeToRemoveUntil, function () {
      _this3.logger_("On QUOTA_EXCEEDED_ERR, retrying append in " + MIN_BACK_BUFFER + "s");

      _this3.waitingOnRemove_ = false; // wait the length of time alotted in the back buffer to prevent wasted
      // attempts (since we can't clear less than the minimum)

      _this3.quotaExceededErrorRetryTimeout_ = window$1.setTimeout(function () {
        _this3.logger_('On QUOTA_EXCEEDED_ERR, re-processing call queue');

        _this3.quotaExceededErrorRetryTimeout_ = null;

        _this3.processCallQueue_();
      }, MIN_BACK_BUFFER * 1000);
    }, true);
  };

  _proto.handleAppendError_ = function handleAppendError_(_ref6, error) {
    var segmentInfo = _ref6.segmentInfo,
        type = _ref6.type,
        bytes = _ref6.bytes;

    // if there's no error, nothing to do
    if (!error) {
      return;
    }

    if (error.code === QUOTA_EXCEEDED_ERR) {
      this.handleQuotaExceededError_({
        segmentInfo: segmentInfo,
        type: type,
        bytes: bytes
      }); // A quota exceeded error should be recoverable with a future re-append, so no need
      // to trigger an append error.

      return;
    }

    this.logger_('Received non QUOTA_EXCEEDED_ERR on append', error); // If an append errors, we often can't recover.
    // (see https://w3c.github.io/media-source/#sourcebuffer-append-error).
    //
    // Trigger a special error so that it can be handled separately from normal,
    // recoverable errors.

    this.error({
      message: type + " append of " + bytes.length + "b failed for segment " + ("#" + segmentInfo.mediaIndex + " in playlist " + segmentInfo.playlist.id),
      metadata: {
        errorType: videojs.Error.SegmentAppendError
      }
    });
    this.trigger('appenderror');
  };

  _proto.appendToSourceBuffer_ = function appendToSourceBuffer_(_ref7) {
    var segmentInfo = _ref7.segmentInfo,
        type = _ref7.type,
        initSegment = _ref7.initSegment,
        data = _ref7.data,
        bytes = _ref7.bytes;

    // If this is a re-append, bytes were already created and don't need to be recreated
    if (!bytes) {
      var segments = [data];
      var byteLength = data.byteLength;

      if (initSegment) {
        // if the media initialization segment is changing, append it before the content
        // segment
        segments.unshift(initSegment);
        byteLength += initSegment.byteLength;
      } // Technically we should be OK appending the init segment separately, however, we
      // haven't yet tested that, and prepending is how we have always done things.


      bytes = concatSegments({
        bytes: byteLength,
        segments: segments
      });
    }

    this.sourceUpdater_.appendBuffer({
      segmentInfo: segmentInfo,
      type: type,
      bytes: bytes
    }, this.handleAppendError_.bind(this, {
      segmentInfo: segmentInfo,
      type: type,
      bytes: bytes
    }));
  };

  _proto.handleSegmentTimingInfo_ = function handleSegmentTimingInfo_(type, requestId, segmentTimingInfo) {
    if (!this.pendingSegment_ || requestId !== this.pendingSegment_.requestId) {
      return;
    }

    var segment = this.pendingSegment_.segment;
    var timingInfoProperty = type + "TimingInfo";

    if (!segment[timingInfoProperty]) {
      segment[timingInfoProperty] = {};
    }

    segment[timingInfoProperty].transmuxerPrependedSeconds = segmentTimingInfo.prependedContentDuration || 0;
    segment[timingInfoProperty].transmuxedPresentationStart = segmentTimingInfo.start.presentation;
    segment[timingInfoProperty].transmuxedDecodeStart = segmentTimingInfo.start.decode;
    segment[timingInfoProperty].transmuxedPresentationEnd = segmentTimingInfo.end.presentation;
    segment[timingInfoProperty].transmuxedDecodeEnd = segmentTimingInfo.end.decode; // mainly used as a reference for debugging

    segment[timingInfoProperty].baseMediaDecodeTime = segmentTimingInfo.baseMediaDecodeTime;
  };

  _proto.appendData_ = function appendData_(segmentInfo, result) {
    var type = result.type,
        data = result.data;

    if (!data || !data.byteLength) {
      return;
    }

    if (type === 'audio' && this.audioDisabled_) {
      return;
    }

    var initSegment = this.getInitSegmentAndUpdateState_({
      type: type,
      initSegment: result.initSegment,
      playlist: segmentInfo.playlist,
      map: segmentInfo.isFmp4 ? segmentInfo.segment.map : null
    });
    this.appendToSourceBuffer_({
      segmentInfo: segmentInfo,
      type: type,
      initSegment: initSegment,
      data: data
    });
  }
  /**
   * load a specific segment from a request into the buffer
   *
   * @private
   */
  ;

  _proto.loadSegment_ = function loadSegment_(segmentInfo) {
    var _this4 = this;

    this.state = 'WAITING';
    this.pendingSegment_ = segmentInfo;
    this.trimBackBuffer_(segmentInfo);

    if (typeof segmentInfo.timestampOffset === 'number') {
      if (this.transmuxer_) {
        this.transmuxer_.postMessage({
          action: 'clearAllMp4Captions'
        });
      }
    }

    if (!this.hasEnoughInfoToLoad_()) {
      this.loadQueue_.push(function () {
        // regenerate the audioAppendStart, timestampOffset, etc as they
        // may have changed since this function was added to the queue.
        var options = _extends({}, segmentInfo, {
          forceTimestampOffset: true
        });

        _extends(segmentInfo, _this4.generateSegmentInfo_(options));

        _this4.isPendingTimestampOffset_ = false;

        _this4.updateTransmuxerAndRequestSegment_(segmentInfo);
      });
      return;
    }

    this.updateTransmuxerAndRequestSegment_(segmentInfo);
  };

  _proto.updateTransmuxerAndRequestSegment_ = function updateTransmuxerAndRequestSegment_(segmentInfo) {
    var _this5 = this;

    // We'll update the source buffer's timestamp offset once we have transmuxed data, but
    // the transmuxer still needs to be updated before then.
    //
    // Even though keepOriginalTimestamps is set to true for the transmuxer, timestamp
    // offset must be passed to the transmuxer for stream correcting adjustments.
    if (this.shouldUpdateTransmuxerTimestampOffset_(segmentInfo.timestampOffset)) {
      this.gopBuffer_.length = 0; // gopsToAlignWith was set before the GOP buffer was cleared

      segmentInfo.gopsToAlignWith = [];
      this.timeMapping_ = 0; // reset values in the transmuxer since a discontinuity should start fresh

      this.transmuxer_.postMessage({
        action: 'reset'
      });
      this.transmuxer_.postMessage({
        action: 'setTimestampOffset',
        timestampOffset: segmentInfo.timestampOffset
      });
    }

    var simpleSegment = this.createSimplifiedSegmentObj_(segmentInfo);
    var isEndOfStream = this.isEndOfStream_(segmentInfo.mediaIndex, segmentInfo.playlist, segmentInfo.partIndex);
    var isWalkingForward = this.mediaIndex !== null;
    var isDiscontinuity = segmentInfo.timeline !== this.currentTimeline_ && // currentTimeline starts at -1, so we shouldn't end the timeline switching to 0,
    // the first timeline
    segmentInfo.timeline > 0;
    var isEndOfTimeline = isEndOfStream || isWalkingForward && isDiscontinuity;
    this.logger_("Requesting\n" + compactSegmentUrlDescription(segmentInfo.uri) + "\n" + segmentInfoString(segmentInfo)); // If there's an init segment associated with this segment, but it is not cached (identified by a lack of bytes),
    // then this init segment has never been seen before and should be appended.
    //
    // At this point the content type (audio/video or both) is not yet known, but it should be safe to set
    // both to true and leave the decision of whether to append the init segment to append time.

    if (simpleSegment.map && !simpleSegment.map.bytes) {
      this.logger_('going to request init segment.');
      this.appendInitSegment_ = {
        video: true,
        audio: true
      };
    }

    segmentInfo.abortRequests = mediaSegmentRequest({
      xhr: this.vhs_.xhr,
      xhrOptions: this.xhrOptions_,
      decryptionWorker: this.decrypter_,
      segment: simpleSegment,
      abortFn: this.handleAbort_.bind(this, segmentInfo),
      progressFn: this.handleProgress_.bind(this),
      trackInfoFn: this.handleTrackInfo_.bind(this),
      timingInfoFn: this.handleTimingInfo_.bind(this),
      videoSegmentTimingInfoFn: this.handleSegmentTimingInfo_.bind(this, 'video', segmentInfo.requestId),
      audioSegmentTimingInfoFn: this.handleSegmentTimingInfo_.bind(this, 'audio', segmentInfo.requestId),
      captionsFn: this.handleCaptions_.bind(this),
      isEndOfTimeline: isEndOfTimeline,
      endedTimelineFn: function endedTimelineFn() {
        _this5.logger_('received endedtimeline callback');
      },
      id3Fn: this.handleId3_.bind(this),
      dataFn: this.handleData_.bind(this),
      doneFn: this.segmentRequestFinished_.bind(this),
      onTransmuxerLog: function onTransmuxerLog(_ref8) {
        var message = _ref8.message,
            level = _ref8.level,
            stream = _ref8.stream;

        _this5.logger_(segmentInfoString(segmentInfo) + " logged from transmuxer stream " + stream + " as a " + level + ": " + message);
      }
    });
  }
  /**
   * trim the back buffer so that we don't have too much data
   * in the source buffer
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   */
  ;

  _proto.trimBackBuffer_ = function trimBackBuffer_(segmentInfo) {
    var removeToTime = safeBackBufferTrimTime(this.seekable_(), this.currentTime_(), this.playlist_.targetDuration || 10); // Chrome has a hard limit of 150MB of
    // buffer and a very conservative "garbage collector"
    // We manually clear out the old buffer to ensure
    // we don't trigger the QuotaExceeded error
    // on the source buffer during subsequent appends

    if (removeToTime > 0) {
      this.remove(0, removeToTime);
    }
  }
  /**
   * created a simplified copy of the segment object with just the
   * information necessary to perform the XHR and decryption
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   * @return {Object} a simplified segment object copy
   */
  ;

  _proto.createSimplifiedSegmentObj_ = function createSimplifiedSegmentObj_(segmentInfo) {
    var segment = segmentInfo.segment;
    var part = segmentInfo.part;
    var simpleSegment = {
      resolvedUri: part ? part.resolvedUri : segment.resolvedUri,
      byterange: part ? part.byterange : segment.byterange,
      requestId: segmentInfo.requestId,
      transmuxer: segmentInfo.transmuxer,
      audioAppendStart: segmentInfo.audioAppendStart,
      gopsToAlignWith: segmentInfo.gopsToAlignWith,
      part: segmentInfo.part
    };
    var previousSegment = segmentInfo.playlist.segments[segmentInfo.mediaIndex - 1];

    if (previousSegment && previousSegment.timeline === segment.timeline) {
      // The baseStartTime of a segment is used to handle rollover when probing the TS
      // segment to retrieve timing information. Since the probe only looks at the media's
      // times (e.g., PTS and DTS values of the segment), and doesn't consider the
      // player's time (e.g., player.currentTime()), baseStartTime should reflect the
      // media time as well. transmuxedDecodeEnd represents the end time of a segment, in
      // seconds of media time, so should be used here. The previous segment is used since
      // the end of the previous segment should represent the beginning of the current
      // segment, so long as they are on the same timeline.
      if (previousSegment.videoTimingInfo) {
        simpleSegment.baseStartTime = previousSegment.videoTimingInfo.transmuxedDecodeEnd;
      } else if (previousSegment.audioTimingInfo) {
        simpleSegment.baseStartTime = previousSegment.audioTimingInfo.transmuxedDecodeEnd;
      }
    }

    if (segment.key) {
      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      var iv = segment.key.iv || new Uint32Array([0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence]);
      simpleSegment.key = this.segmentKey(segment.key);
      simpleSegment.key.iv = iv;
    }

    if (segment.map) {
      simpleSegment.map = this.initSegmentForMap(segment.map);
    }

    return simpleSegment;
  };

  _proto.saveTransferStats_ = function saveTransferStats_(stats) {
    // every request counts as a media request even if it has been aborted
    // or canceled due to a timeout
    this.mediaRequests += 1;

    if (stats) {
      this.mediaBytesTransferred += stats.bytesReceived;
      this.mediaTransferDuration += stats.roundTripTime;
    }
  };

  _proto.saveBandwidthRelatedStats_ = function saveBandwidthRelatedStats_(duration, stats) {
    // byteLength will be used for throughput, and should be based on bytes receieved,
    // which we only know at the end of the request and should reflect total bytes
    // downloaded rather than just bytes processed from components of the segment
    this.pendingSegment_.byteLength = stats.bytesReceived;

    if (duration < MIN_SEGMENT_DURATION_TO_SAVE_STATS) {
      this.logger_("Ignoring segment's bandwidth because its duration of " + duration + (" is less than the min to record " + MIN_SEGMENT_DURATION_TO_SAVE_STATS));
      return;
    }

    this.bandwidth = stats.bandwidth;
    this.roundTrip = stats.roundTripTime;
  };

  _proto.handleTimeout_ = function handleTimeout_() {
    // although the VTT segment loader bandwidth isn't really used, it's good to
    // maintain functinality between segment loaders
    this.mediaRequestsTimedout += 1;
    this.bandwidth = 1;
    this.roundTrip = NaN;
    this.trigger('bandwidthupdate');
    this.trigger('timeout');
  }
  /**
   * Handle the callback from the segmentRequest function and set the
   * associated SegmentLoader state and errors if necessary
   *
   * @private
   */
  ;

  _proto.segmentRequestFinished_ = function segmentRequestFinished_(error, simpleSegment, result) {
    // TODO handle special cases, e.g., muxed audio/video but only audio in the segment
    // check the call queue directly since this function doesn't need to deal with any
    // data, and can continue even if the source buffers are not set up and we didn't get
    // any data from the segment
    if (this.callQueue_.length) {
      this.callQueue_.push(this.segmentRequestFinished_.bind(this, error, simpleSegment, result));
      return;
    }

    this.saveTransferStats_(simpleSegment.stats); // The request was aborted and the SegmentLoader has already been reset

    if (!this.pendingSegment_) {
      return;
    } // the request was aborted and the SegmentLoader has already started
    // another request. this can happen when the timeout for an aborted
    // request triggers due to a limitation in the XHR library
    // do not count this as any sort of request or we risk double-counting


    if (simpleSegment.requestId !== this.pendingSegment_.requestId) {
      return;
    } // an error occurred from the active pendingSegment_ so reset everything


    if (error) {
      this.pendingSegment_ = null;
      this.state = 'READY'; // aborts are not a true error condition and nothing corrective needs to be done

      if (error.code === REQUEST_ERRORS.ABORTED) {
        return;
      }

      this.pause(); // the error is really just that at least one of the requests timed-out
      // set the bandwidth to a very low value and trigger an ABR switch to
      // take emergency action

      if (error.code === REQUEST_ERRORS.TIMEOUT) {
        this.handleTimeout_();
        return;
      } // if control-flow has arrived here, then the error is real
      // emit an error event to exclude the current playlist


      this.mediaRequestsErrored += 1;
      this.error(error);
      this.trigger('error');
      return;
    }

    var segmentInfo = this.pendingSegment_; // the response was a success so set any bandwidth stats the request
    // generated for ABR purposes

    this.saveBandwidthRelatedStats_(segmentInfo.duration, simpleSegment.stats);
    segmentInfo.endOfAllRequests = simpleSegment.endOfAllRequests;

    if (result.gopInfo) {
      this.gopBuffer_ = updateGopBuffer(this.gopBuffer_, result.gopInfo, this.safeAppend_);
    } // Although we may have already started appending on progress, we shouldn't switch the
    // state away from loading until we are officially done loading the segment data.


    this.state = 'APPENDING'; // used for testing

    this.trigger('appending');
    this.waitForAppendsToComplete_(segmentInfo);
  };

  _proto.setTimeMapping_ = function setTimeMapping_(timeline) {
    var timelineMapping = this.syncController_.mappingForTimeline(timeline);

    if (timelineMapping !== null) {
      this.timeMapping_ = timelineMapping;
    }
  };

  _proto.updateMediaSecondsLoaded_ = function updateMediaSecondsLoaded_(segment) {
    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
      this.mediaSecondsLoaded += segment.end - segment.start;
    } else {
      this.mediaSecondsLoaded += segment.duration;
    }
  };

  _proto.shouldUpdateTransmuxerTimestampOffset_ = function shouldUpdateTransmuxerTimestampOffset_(timestampOffset) {
    if (timestampOffset === null) {
      return false;
    } // note that we're potentially using the same timestamp offset for both video and
    // audio


    if (this.loaderType_ === 'main' && timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      return true;
    }

    if (!this.audioDisabled_ && timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      return true;
    }

    return false;
  };

  _proto.trueSegmentStart_ = function trueSegmentStart_(_ref9) {
    var currentStart = _ref9.currentStart,
        playlist = _ref9.playlist,
        mediaIndex = _ref9.mediaIndex,
        firstVideoFrameTimeForData = _ref9.firstVideoFrameTimeForData,
        currentVideoTimestampOffset = _ref9.currentVideoTimestampOffset,
        useVideoTimingInfo = _ref9.useVideoTimingInfo,
        videoTimingInfo = _ref9.videoTimingInfo,
        audioTimingInfo = _ref9.audioTimingInfo;

    if (typeof currentStart !== 'undefined') {
      // if start was set once, keep using it
      return currentStart;
    }

    if (!useVideoTimingInfo) {
      return audioTimingInfo.start;
    }

    var previousSegment = playlist.segments[mediaIndex - 1]; // The start of a segment should be the start of the first full frame contained
    // within that segment. Since the transmuxer maintains a cache of incomplete data
    // from and/or the last frame seen, the start time may reflect a frame that starts
    // in the previous segment. Check for that case and ensure the start time is
    // accurate for the segment.

    if (mediaIndex === 0 || !previousSegment || typeof previousSegment.start === 'undefined' || previousSegment.end !== firstVideoFrameTimeForData + currentVideoTimestampOffset) {
      return firstVideoFrameTimeForData;
    }

    return videoTimingInfo.start;
  };

  _proto.waitForAppendsToComplete_ = function waitForAppendsToComplete_(segmentInfo) {
    var trackInfo = this.getCurrentMediaInfo_(segmentInfo);

    if (!trackInfo) {
      this.error({
        message: 'No starting media returned, likely due to an unsupported media format.',
        playlistExclusionDuration: Infinity,
        metadata: {
          errorType: videojs.Error.SegmentUnsupportedMediaFormat
        }
      });
      this.trigger('error');
      return;
    } // Although transmuxing is done, appends may not yet be finished. Throw a marker
    // on each queue this loader is responsible for to ensure that the appends are
    // complete.


    var hasAudio = trackInfo.hasAudio,
        hasVideo = trackInfo.hasVideo,
        isMuxed = trackInfo.isMuxed;
    var waitForVideo = this.loaderType_ === 'main' && hasVideo;
    var waitForAudio = !this.audioDisabled_ && hasAudio && !isMuxed;
    segmentInfo.waitingOnAppends = 0; // segments with no data

    if (!segmentInfo.hasAppendedData_) {
      if (!segmentInfo.timingInfo && typeof segmentInfo.timestampOffset === 'number') {
        // When there's no audio or video data in the segment, there's no audio or video
        // timing information.
        //
        // If there's no audio or video timing information, then the timestamp offset
        // can't be adjusted to the appropriate value for the transmuxer and source
        // buffers.
        //
        // Therefore, the next segment should be used to set the timestamp offset.
        this.isPendingTimestampOffset_ = true;
      } // override settings for metadata only segments


      segmentInfo.timingInfo = {
        start: 0
      };
      segmentInfo.waitingOnAppends++;

      if (!this.isPendingTimestampOffset_) {
        // update the timestampoffset
        this.updateSourceBufferTimestampOffset_(segmentInfo); // make sure the metadata queue is processed even though we have
        // no video/audio data.

        this.processMetadataQueue_();
      } // append is "done" instantly with no data.


      this.checkAppendsDone_(segmentInfo);
      return;
    } // Since source updater could call back synchronously, do the increments first.


    if (waitForVideo) {
      segmentInfo.waitingOnAppends++;
    }

    if (waitForAudio) {
      segmentInfo.waitingOnAppends++;
    }

    if (waitForVideo) {
      this.sourceUpdater_.videoQueueCallback(this.checkAppendsDone_.bind(this, segmentInfo));
    }

    if (waitForAudio) {
      this.sourceUpdater_.audioQueueCallback(this.checkAppendsDone_.bind(this, segmentInfo));
    }
  };

  _proto.checkAppendsDone_ = function checkAppendsDone_(segmentInfo) {
    if (this.checkForAbort_(segmentInfo.requestId)) {
      return;
    }

    segmentInfo.waitingOnAppends--;

    if (segmentInfo.waitingOnAppends === 0) {
      this.handleAppendsDone_();
    }
  };

  _proto.checkForIllegalMediaSwitch = function checkForIllegalMediaSwitch(trackInfo) {
    var illegalMediaSwitchError = illegalMediaSwitch(this.loaderType_, this.getCurrentMediaInfo_(), trackInfo);

    if (illegalMediaSwitchError) {
      this.error({
        message: illegalMediaSwitchError,
        playlistExclusionDuration: Infinity,
        metadata: {
          errorType: videojs.Error.SegmentSwitchError
        }
      });
      this.trigger('error');
      return true;
    }

    return false;
  };

  _proto.updateSourceBufferTimestampOffset_ = function updateSourceBufferTimestampOffset_(segmentInfo) {
    if (segmentInfo.timestampOffset === null || // we don't yet have the start for whatever media type (video or audio) has
    // priority, timing-wise, so we must wait
    typeof segmentInfo.timingInfo.start !== 'number' || // already updated the timestamp offset for this segment
    segmentInfo.changedTimestampOffset || // the alt audio loader should not be responsible for setting the timestamp offset
    this.loaderType_ !== 'main') {
      return;
    }

    var didChange = false; // Primary timing goes by video, and audio is trimmed in the transmuxer, meaning that
    // the timing info here comes from video. In the event that the audio is longer than
    // the video, this will trim the start of the audio.
    // This also trims any offset from 0 at the beginning of the media

    segmentInfo.timestampOffset -= this.getSegmentStartTimeForTimestampOffsetCalculation_({
      videoTimingInfo: segmentInfo.segment.videoTimingInfo,
      audioTimingInfo: segmentInfo.segment.audioTimingInfo,
      timingInfo: segmentInfo.timingInfo
    }); // In the event that there are part segment downloads, each will try to update the
    // timestamp offset. Retaining this bit of state prevents us from updating in the
    // future (within the same segment), however, there may be a better way to handle it.

    segmentInfo.changedTimestampOffset = true;

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      this.sourceUpdater_.videoTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      this.sourceUpdater_.audioTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (didChange) {
      this.trigger('timestampoffset');
    }
  };

  _proto.getSegmentStartTimeForTimestampOffsetCalculation_ = function getSegmentStartTimeForTimestampOffsetCalculation_(_ref10) {
    var videoTimingInfo = _ref10.videoTimingInfo,
        audioTimingInfo = _ref10.audioTimingInfo,
        timingInfo = _ref10.timingInfo;

    if (!this.useDtsForTimestampOffset_) {
      return timingInfo.start;
    }

    if (videoTimingInfo && typeof videoTimingInfo.transmuxedDecodeStart === 'number') {
      return videoTimingInfo.transmuxedDecodeStart;
    } // handle audio only


    if (audioTimingInfo && typeof audioTimingInfo.transmuxedDecodeStart === 'number') {
      return audioTimingInfo.transmuxedDecodeStart;
    } // handle content not transmuxed (e.g., MP4)


    return timingInfo.start;
  };

  _proto.updateTimingInfoEnd_ = function updateTimingInfoEnd_(segmentInfo) {
    segmentInfo.timingInfo = segmentInfo.timingInfo || {};
    var trackInfo = this.getMediaInfo_();
    var useVideoTimingInfo = this.loaderType_ === 'main' && trackInfo && trackInfo.hasVideo;
    var prioritizedTimingInfo = useVideoTimingInfo && segmentInfo.videoTimingInfo ? segmentInfo.videoTimingInfo : segmentInfo.audioTimingInfo;

    if (!prioritizedTimingInfo) {
      return;
    }

    segmentInfo.timingInfo.end = typeof prioritizedTimingInfo.end === 'number' ? // End time may not exist in a case where we aren't parsing the full segment (one
    // current example is the case of fmp4), so use the rough duration to calculate an
    // end time.
    prioritizedTimingInfo.end : prioritizedTimingInfo.start + segmentInfo.duration;
  }
  /**
   * callback to run when appendBuffer is finished. detects if we are
   * in a good state to do things with the data we got, or if we need
   * to wait for more
   *
   * @private
   */
  ;

  _proto.handleAppendsDone_ = function handleAppendsDone_() {
    // appendsdone can cause an abort
    if (this.pendingSegment_) {
      this.trigger('appendsdone');
    }

    if (!this.pendingSegment_) {
      this.state = 'READY'; // TODO should this move into this.checkForAbort to speed up requests post abort in
      // all appending cases?

      if (!this.paused()) {
        this.monitorBuffer_();
      }

      return;
    }

    var segmentInfo = this.pendingSegment_;

    if (segmentInfo.part && segmentInfo.part.syncInfo) {
      // low-latency flow
      segmentInfo.part.syncInfo.markAppended();
    } else if (segmentInfo.segment.syncInfo) {
      // normal flow
      segmentInfo.segment.syncInfo.markAppended();
    } // Now that the end of the segment has been reached, we can set the end time. It's
    // best to wait until all appends are done so we're sure that the primary media is
    // finished (and we have its end time).


    this.updateTimingInfoEnd_(segmentInfo);

    if (this.shouldSaveSegmentTimingInfo_) {
      // Timeline mappings should only be saved for the main loader. This is for multiple
      // reasons:
      //
      // 1) Only one mapping is saved per timeline, meaning that if both the audio loader
      //    and the main loader try to save the timeline mapping, whichever comes later
      //    will overwrite the first. In theory this is OK, as the mappings should be the
      //    same, however, it breaks for (2)
      // 2) In the event of a live stream, the initial live point will make for a somewhat
      //    arbitrary mapping. If audio and video streams are not perfectly in-sync, then
      //    the mapping will be off for one of the streams, dependent on which one was
      //    first saved (see (1)).
      // 3) Primary timing goes by video in VHS, so the mapping should be video.
      //
      // Since the audio loader will wait for the main loader to load the first segment,
      // the main loader will save the first timeline mapping, and ensure that there won't
      // be a case where audio loads two segments without saving a mapping (thus leading
      // to missing segment timing info).
      this.syncController_.saveSegmentTimingInfo({
        segmentInfo: segmentInfo,
        shouldSaveTimelineMapping: this.loaderType_ === 'main'
      });
    }

    var segmentDurationMessage = getTroublesomeSegmentDurationMessage(segmentInfo, this.sourceType_);

    if (segmentDurationMessage) {
      if (segmentDurationMessage.severity === 'warn') {
        videojs.log.warn(segmentDurationMessage.message);
      } else {
        this.logger_(segmentDurationMessage.message);
      }
    }

    this.recordThroughput_(segmentInfo);
    this.pendingSegment_ = null;
    this.state = 'READY';

    if (segmentInfo.isSyncRequest) {
      this.trigger('syncinfoupdate'); // if the sync request was not appended
      // then it was not the correct segment.
      // throw it away and use the data it gave us
      // to get the correct one.

      if (!segmentInfo.hasAppendedData_) {
        this.logger_("Throwing away un-appended sync request " + segmentInfoString(segmentInfo));
        return;
      }
    }

    this.logger_("Appended " + segmentInfoString(segmentInfo));
    this.addSegmentMetadataCue_(segmentInfo);
    this.fetchAtBuffer_ = true;

    if (this.currentTimeline_ !== segmentInfo.timeline) {
      this.timelineChangeController_.lastTimelineChange({
        type: this.loaderType_,
        from: this.currentTimeline_,
        to: segmentInfo.timeline
      }); // If audio is not disabled, the main segment loader is responsible for updating
      // the audio timeline as well. If the content is video only, this won't have any
      // impact.

      if (this.loaderType_ === 'main' && !this.audioDisabled_) {
        this.timelineChangeController_.lastTimelineChange({
          type: 'audio',
          from: this.currentTimeline_,
          to: segmentInfo.timeline
        });
      }
    }

    this.currentTimeline_ = segmentInfo.timeline; // We must update the syncinfo to recalculate the seekable range before
    // the following conditional otherwise it may consider this a bad "guess"
    // and attempt to resync when the post-update seekable window and live
    // point would mean that this was the perfect segment to fetch

    this.trigger('syncinfoupdate');
    var segment = segmentInfo.segment;
    var part = segmentInfo.part;
    var badSegmentGuess = segment.end && this.currentTime_() - segment.end > segmentInfo.playlist.targetDuration * 3;
    var badPartGuess = part && part.end && this.currentTime_() - part.end > segmentInfo.playlist.partTargetDuration * 3; // If we previously appended a segment/part that ends more than 3 part/targetDurations before
    // the currentTime_ that means that our conservative guess was too conservative.
    // In that case, reset the loader state so that we try to use any information gained
    // from the previous request to create a new, more accurate, sync-point.

    if (badSegmentGuess || badPartGuess) {
      this.logger_("bad " + (badSegmentGuess ? 'segment' : 'part') + " " + segmentInfoString(segmentInfo));
      this.resetEverything();
      return;
    }

    var isWalkingForward = this.mediaIndex !== null; // Don't do a rendition switch unless we have enough time to get a sync segment
    // and conservatively guess

    if (isWalkingForward) {
      this.trigger('bandwidthupdate');
    }

    this.trigger('progress');
    this.mediaIndex = segmentInfo.mediaIndex;
    this.partIndex = segmentInfo.partIndex; // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.

    if (this.isEndOfStream_(segmentInfo.mediaIndex, segmentInfo.playlist, segmentInfo.partIndex)) {
      this.endOfStream();
    } // used for testing


    this.trigger('appended');

    if (segmentInfo.hasAppendedData_) {
      this.mediaAppends++;
    }

    if (!this.paused()) {
      this.monitorBuffer_();
    }
  }
  /**
   * Records the current throughput of the decrypt, transmux, and append
   * portion of the semgment pipeline. `throughput.rate` is a the cumulative
   * moving average of the throughput. `throughput.count` is the number of
   * data points in the average.
   *
   * @private
   * @param {Object} segmentInfo the object returned by loadSegment
   */
  ;

  _proto.recordThroughput_ = function recordThroughput_(segmentInfo) {
    if (segmentInfo.duration < MIN_SEGMENT_DURATION_TO_SAVE_STATS) {
      this.logger_("Ignoring segment's throughput because its duration of " + segmentInfo.duration + (" is less than the min to record " + MIN_SEGMENT_DURATION_TO_SAVE_STATS));
      return;
    }

    var rate = this.throughput.rate; // Add one to the time to ensure that we don't accidentally attempt to divide
    // by zero in the case where the throughput is ridiculously high

    var segmentProcessingTime = Date.now() - segmentInfo.endOfAllRequests + 1; // Multiply by 8000 to convert from bytes/millisecond to bits/second

    var segmentProcessingThroughput = Math.floor(segmentInfo.byteLength / segmentProcessingTime * 8 * 1000); // This is just a cumulative moving average calculation:
    //   newAvg = oldAvg + (sample - oldAvg) / (sampleCount + 1)

    this.throughput.rate += (segmentProcessingThroughput - rate) / ++this.throughput.count;
  }
  /**
   * Adds a cue to the segment-metadata track with some metadata information about the
   * segment
   *
   * @private
   * @param {Object} segmentInfo
   *        the object returned by loadSegment
   * @method addSegmentMetadataCue_
   */
  ;

  _proto.addSegmentMetadataCue_ = function addSegmentMetadataCue_(segmentInfo) {
    if (!this.segmentMetadataTrack_) {
      return;
    }

    var segment = segmentInfo.segment;
    var start = segment.start;
    var end = segment.end; // Do not try adding the cue if the start and end times are invalid.

    if (!finite(start) || !finite(end)) {
      return;
    }

    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);
    var Cue = window$1.WebKitDataCue || window$1.VTTCue;
    var value = {
      custom: segment.custom,
      dateTimeObject: segment.dateTimeObject,
      dateTimeString: segment.dateTimeString,
      programDateTime: segment.programDateTime,
      bandwidth: segmentInfo.playlist.attributes.BANDWIDTH,
      resolution: segmentInfo.playlist.attributes.RESOLUTION,
      codecs: segmentInfo.playlist.attributes.CODECS,
      byteLength: segmentInfo.byteLength,
      uri: segmentInfo.uri,
      timeline: segmentInfo.timeline,
      playlist: segmentInfo.playlist.id,
      start: start,
      end: end
    };
    var data = JSON.stringify(value);
    var cue = new Cue(start, end, data); // Attach the metadata to the value property of the cue to keep consistency between
    // the differences of WebKitDataCue in safari and VTTCue in other browsers

    cue.value = value;
    this.segmentMetadataTrack_.addCue(cue);
  };

  _createClass(SegmentLoader, [{
    key: "mediaSequenceSync_",
    get: function get() {
      return this.syncController_.getMediaSequenceSync(this.loaderType_);
    }
  }]);

  return SegmentLoader;
}(videojs.EventTarget);

function noop() {}

var toTitleCase = function toTitleCase(string) {
  if (typeof string !== 'string') {
    return string;
  }

  return string.replace(/./, function (w) {
    return w.toUpperCase();
  });
};

var bufferTypes = ['video', 'audio'];

var _updating = function updating(type, sourceUpdater) {
  var sourceBuffer = sourceUpdater[type + "Buffer"];
  return sourceBuffer && sourceBuffer.updating || sourceUpdater.queuePending[type];
};

var nextQueueIndexOfType = function nextQueueIndexOfType(type, queue) {
  for (var i = 0; i < queue.length; i++) {
    var queueEntry = queue[i];

    if (queueEntry.type === 'mediaSource') {
      // If the next entry is a media source entry (uses multiple source buffers), block
      // processing to allow it to go through first.
      return null;
    }

    if (queueEntry.type === type) {
      return i;
    }
  }

  return null;
};

var shiftQueue = function shiftQueue(type, sourceUpdater) {
  if (sourceUpdater.queue.length === 0) {
    return;
  }

  var queueIndex = 0;
  var queueEntry = sourceUpdater.queue[queueIndex];

  if (queueEntry.type === 'mediaSource') {
    if (!sourceUpdater.updating() && sourceUpdater.mediaSource.readyState !== 'closed') {
      sourceUpdater.queue.shift();
      queueEntry.action(sourceUpdater);

      if (queueEntry.doneFn) {
        queueEntry.doneFn();
      } // Only specific source buffer actions must wait for async updateend events. Media
      // Source actions process synchronously. Therefore, both audio and video source
      // buffers are now clear to process the next queue entries.


      shiftQueue('audio', sourceUpdater);
      shiftQueue('video', sourceUpdater);
    } // Media Source actions require both source buffers, so if the media source action
    // couldn't process yet (because one or both source buffers are busy), block other
    // queue actions until both are available and the media source action can process.


    return;
  }

  if (type === 'mediaSource') {
    // If the queue was shifted by a media source action (this happens when pushing a
    // media source action onto the queue), then it wasn't from an updateend event from an
    // audio or video source buffer, so there's no change from previous state, and no
    // processing should be done.
    return;
  } // Media source queue entries don't need to consider whether the source updater is
  // started (i.e., source buffers are created) as they don't need the source buffers, but
  // source buffer queue entries do.


  if (!sourceUpdater.ready() || sourceUpdater.mediaSource.readyState === 'closed' || _updating(type, sourceUpdater)) {
    return;
  }

  if (queueEntry.type !== type) {
    queueIndex = nextQueueIndexOfType(type, sourceUpdater.queue);

    if (queueIndex === null) {
      // Either there's no queue entry that uses this source buffer type in the queue, or
      // there's a media source queue entry before the next entry of this type, in which
      // case wait for that action to process first.
      return;
    }

    queueEntry = sourceUpdater.queue[queueIndex];
  }

  sourceUpdater.queue.splice(queueIndex, 1); // Keep a record that this source buffer type is in use.
  //
  // The queue pending operation must be set before the action is performed in the event
  // that the action results in a synchronous event that is acted upon. For instance, if
  // an exception is thrown that can be handled, it's possible that new actions will be
  // appended to an empty queue and immediately executed, but would not have the correct
  // pending information if this property was set after the action was performed.

  sourceUpdater.queuePending[type] = queueEntry;
  queueEntry.action(type, sourceUpdater);

  if (!queueEntry.doneFn) {
    // synchronous operation, process next entry
    sourceUpdater.queuePending[type] = null;
    shiftQueue(type, sourceUpdater);
    return;
  }
};

var cleanupBuffer = function cleanupBuffer(type, sourceUpdater) {
  var buffer = sourceUpdater[type + "Buffer"];
  var titleType = toTitleCase(type);

  if (!buffer) {
    return;
  }

  buffer.removeEventListener('updateend', sourceUpdater["on" + titleType + "UpdateEnd_"]);
  buffer.removeEventListener('error', sourceUpdater["on" + titleType + "Error_"]);
  sourceUpdater.codecs[type] = null;
  sourceUpdater[type + "Buffer"] = null;
};

var inSourceBuffers = function inSourceBuffers(mediaSource, sourceBuffer) {
  return mediaSource && sourceBuffer && Array.prototype.indexOf.call(mediaSource.sourceBuffers, sourceBuffer) !== -1;
};

var actions = {
  appendBuffer: function appendBuffer(bytes, segmentInfo, onError) {
    return function (type, sourceUpdater) {
      var sourceBuffer = sourceUpdater[type + "Buffer"]; // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      }

      sourceUpdater.logger_("Appending segment " + segmentInfo.mediaIndex + "'s " + bytes.length + " bytes to " + type + "Buffer");

      try {
        sourceBuffer.appendBuffer(bytes);
      } catch (e) {
        sourceUpdater.logger_("Error with code " + e.code + " " + (e.code === QUOTA_EXCEEDED_ERR ? '(QUOTA_EXCEEDED_ERR) ' : '') + ("when appending segment " + segmentInfo.mediaIndex + " to " + type + "Buffer"));
        sourceUpdater.queuePending[type] = null;
        onError(e);
      }
    };
  },
  remove: function remove(start, end) {
    return function (type, sourceUpdater) {
      var sourceBuffer = sourceUpdater[type + "Buffer"]; // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      }

      sourceUpdater.logger_("Removing " + start + " to " + end + " from " + type + "Buffer");

      try {
        sourceBuffer.remove(start, end);
      } catch (e) {
        sourceUpdater.logger_("Remove " + start + " to " + end + " from " + type + "Buffer failed");
      }
    };
  },
  timestampOffset: function timestampOffset(offset) {
    return function (type, sourceUpdater) {
      var sourceBuffer = sourceUpdater[type + "Buffer"]; // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      }

      sourceUpdater.logger_("Setting " + type + "timestampOffset to " + offset);
      sourceBuffer.timestampOffset = offset;
    };
  },
  callback: function callback(_callback) {
    return function (type, sourceUpdater) {
      _callback();
    };
  },
  endOfStream: function endOfStream(error) {
    return function (sourceUpdater) {
      if (sourceUpdater.mediaSource.readyState !== 'open') {
        return;
      }

      sourceUpdater.logger_("Calling mediaSource endOfStream(" + (error || '') + ")");

      try {
        sourceUpdater.mediaSource.endOfStream(error);
      } catch (e) {
        videojs.log.warn('Failed to call media source endOfStream', e);
      }
    };
  },
  duration: function duration(_duration) {
    return function (sourceUpdater) {
      sourceUpdater.logger_("Setting mediaSource duration to " + _duration);

      try {
        sourceUpdater.mediaSource.duration = _duration;
      } catch (e) {
        videojs.log.warn('Failed to set media source duration', e);
      }
    };
  },
  abort: function abort() {
    return function (type, sourceUpdater) {
      if (sourceUpdater.mediaSource.readyState !== 'open') {
        return;
      }

      var sourceBuffer = sourceUpdater[type + "Buffer"]; // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      }

      sourceUpdater.logger_("calling abort on " + type + "Buffer");

      try {
        sourceBuffer.abort();
      } catch (e) {
        videojs.log.warn("Failed to abort on " + type + "Buffer", e);
      }
    };
  },
  addSourceBuffer: function addSourceBuffer(type, codec) {
    return function (sourceUpdater) {
      var titleType = toTitleCase(type);
      var mime = getMimeForCodec(codec);
      sourceUpdater.logger_("Adding " + type + "Buffer with codec " + codec + " to mediaSource");
      var sourceBuffer = sourceUpdater.mediaSource.addSourceBuffer(mime);
      sourceBuffer.addEventListener('updateend', sourceUpdater["on" + titleType + "UpdateEnd_"]);
      sourceBuffer.addEventListener('error', sourceUpdater["on" + titleType + "Error_"]);
      sourceUpdater.codecs[type] = codec;
      sourceUpdater[type + "Buffer"] = sourceBuffer;
    };
  },
  removeSourceBuffer: function removeSourceBuffer(type) {
    return function (sourceUpdater) {
      var sourceBuffer = sourceUpdater[type + "Buffer"];
      cleanupBuffer(type, sourceUpdater); // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      }

      sourceUpdater.logger_("Removing " + type + "Buffer with codec " + sourceUpdater.codecs[type] + " from mediaSource");

      try {
        sourceUpdater.mediaSource.removeSourceBuffer(sourceBuffer);
      } catch (e) {
        videojs.log.warn("Failed to removeSourceBuffer " + type + "Buffer", e);
      }
    };
  },
  changeType: function changeType(codec) {
    return function (type, sourceUpdater) {
      var sourceBuffer = sourceUpdater[type + "Buffer"];
      var mime = getMimeForCodec(codec); // can't do anything if the media source / source buffer is null
      // or the media source does not contain this source buffer.

      if (!inSourceBuffers(sourceUpdater.mediaSource, sourceBuffer)) {
        return;
      } // do not update codec if we don't need to.
      // Only update if we change the codec base.
      // For example, going from avc1.640028 to avc1.64001f does not require a changeType call.


      var newCodecBase = codec.substring(0, codec.indexOf('.'));
      var oldCodec = sourceUpdater.codecs[type];
      var oldCodecBase = oldCodec.substring(0, oldCodec.indexOf('.'));

      if (oldCodecBase === newCodecBase) {
        return;
      }

      sourceUpdater.logger_("changing " + type + "Buffer codec from " + sourceUpdater.codecs[type] + " to " + codec); // check if change to the provided type is supported

      try {
        sourceBuffer.changeType(mime);
        sourceUpdater.codecs[type] = codec;
      } catch (e) {
        videojs.log.warn("Failed to changeType on " + type + "Buffer", e);
      }
    };
  }
};

var pushQueue = function pushQueue(_ref) {
  var type = _ref.type,
      sourceUpdater = _ref.sourceUpdater,
      action = _ref.action,
      doneFn = _ref.doneFn,
      name = _ref.name;
  sourceUpdater.queue.push({
    type: type,
    action: action,
    doneFn: doneFn,
    name: name
  });
  shiftQueue(type, sourceUpdater);
};

var onUpdateend = function onUpdateend(type, sourceUpdater) {
  return function (e) {
    // Although there should, in theory, be a pending action for any updateend receieved,
    // there are some actions that may trigger updateend events without set definitions in
    // the w3c spec. For instance, setting the duration on the media source may trigger
    // updateend events on source buffers. This does not appear to be in the spec. As such,
    // if we encounter an updateend without a corresponding pending action from our queue
    // for that source buffer type, process the next action.
    var bufferedRangesForType = sourceUpdater[type + "Buffered"]();
    var descriptiveString = bufferedRangesToString(bufferedRangesForType);
    sourceUpdater.logger_("received \"updateend\" event for " + type + " Source Buffer: ", descriptiveString);

    if (sourceUpdater.queuePending[type]) {
      var doneFn = sourceUpdater.queuePending[type].doneFn;
      sourceUpdater.queuePending[type] = null;

      if (doneFn) {
        // if there's an error, report it
        doneFn(sourceUpdater[type + "Error_"]);
      }
    }

    shiftQueue(type, sourceUpdater);
  };
};
/**
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state. It is used by the segment loader to update the
 * underlying SourceBuffers when new data is loaded, for instance.
 *
 * @class SourceUpdater
 * @param {MediaSource} mediaSource the MediaSource to create the SourceBuffer from
 * @param {string} mimeType the desired MIME type of the underlying SourceBuffer
 */


var SourceUpdater = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(SourceUpdater, _videojs$EventTarget);

  function SourceUpdater(mediaSource) {
    var _this;

    _this = _videojs$EventTarget.call(this) || this;
    _this.mediaSource = mediaSource;

    _this.sourceopenListener_ = function () {
      return shiftQueue('mediaSource', _assertThisInitialized(_this));
    };

    _this.mediaSource.addEventListener('sourceopen', _this.sourceopenListener_);

    _this.logger_ = logger('SourceUpdater'); // initial timestamp offset is 0

    _this.audioTimestampOffset_ = 0;
    _this.videoTimestampOffset_ = 0;
    _this.queue = [];
    _this.queuePending = {
      audio: null,
      video: null
    };
    _this.delayedAudioAppendQueue_ = [];
    _this.videoAppendQueued_ = false;
    _this.codecs = {};
    _this.onVideoUpdateEnd_ = onUpdateend('video', _assertThisInitialized(_this));
    _this.onAudioUpdateEnd_ = onUpdateend('audio', _assertThisInitialized(_this));

    _this.onVideoError_ = function (e) {
      // used for debugging
      _this.videoError_ = e;
    };

    _this.onAudioError_ = function (e) {
      // used for debugging
      _this.audioError_ = e;
    };

    _this.createdSourceBuffers_ = false;
    _this.initializedEme_ = false;
    _this.triggeredReady_ = false;
    return _this;
  }

  var _proto = SourceUpdater.prototype;

  _proto.initializedEme = function initializedEme() {
    this.initializedEme_ = true;
    this.triggerReady();
  };

  _proto.hasCreatedSourceBuffers = function hasCreatedSourceBuffers() {
    // if false, likely waiting on one of the segment loaders to get enough data to create
    // source buffers
    return this.createdSourceBuffers_;
  };

  _proto.hasInitializedAnyEme = function hasInitializedAnyEme() {
    return this.initializedEme_;
  };

  _proto.ready = function ready() {
    return this.hasCreatedSourceBuffers() && this.hasInitializedAnyEme();
  };

  _proto.createSourceBuffers = function createSourceBuffers(codecs) {
    if (this.hasCreatedSourceBuffers()) {
      // already created them before
      return;
    } // the intial addOrChangeSourceBuffers will always be
    // two add buffers.


    this.addOrChangeSourceBuffers(codecs);
    this.createdSourceBuffers_ = true;
    this.trigger('createdsourcebuffers');
    this.triggerReady();
  };

  _proto.triggerReady = function triggerReady() {
    // only allow ready to be triggered once, this prevents the case
    // where:
    // 1. we trigger createdsourcebuffers
    // 2. ie 11 synchronously initializates eme
    // 3. the synchronous initialization causes us to trigger ready
    // 4. We go back to the ready check in createSourceBuffers and ready is triggered again.
    if (this.ready() && !this.triggeredReady_) {
      this.triggeredReady_ = true;
      this.trigger('ready');
    }
  }
  /**
   * Add a type of source buffer to the media source.
   *
   * @param {string} type
   *        The type of source buffer to add.
   *
   * @param {string} codec
   *        The codec to add the source buffer with.
   */
  ;

  _proto.addSourceBuffer = function addSourceBuffer(type, codec) {
    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.addSourceBuffer(type, codec),
      name: 'addSourceBuffer'
    });
  }
  /**
   * call abort on a source buffer.
   *
   * @param {string} type
   *        The type of source buffer to call abort on.
   */
  ;

  _proto.abort = function abort(type) {
    pushQueue({
      type: type,
      sourceUpdater: this,
      action: actions.abort(type),
      name: 'abort'
    });
  }
  /**
   * Call removeSourceBuffer and remove a specific type
   * of source buffer on the mediaSource.
   *
   * @param {string} type
   *        The type of source buffer to remove.
   */
  ;

  _proto.removeSourceBuffer = function removeSourceBuffer(type) {
    if (!this.canRemoveSourceBuffer()) {
      videojs.log.error('removeSourceBuffer is not supported!');
      return;
    }

    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.removeSourceBuffer(type),
      name: 'removeSourceBuffer'
    });
  }
  /**
   * Whether or not the removeSourceBuffer function is supported
   * on the mediaSource.
   *
   * @return {boolean}
   *          if removeSourceBuffer can be called.
   */
  ;

  _proto.canRemoveSourceBuffer = function canRemoveSourceBuffer() {
    // As of Firefox 83 removeSourceBuffer
    // throws errors, so we report that it does not support this.
    return !videojs.browser.IS_FIREFOX && window$1.MediaSource && window$1.MediaSource.prototype && typeof window$1.MediaSource.prototype.removeSourceBuffer === 'function';
  }
  /**
   * Whether or not the changeType function is supported
   * on our SourceBuffers.
   *
   * @return {boolean}
   *         if changeType can be called.
   */
  ;

  SourceUpdater.canChangeType = function canChangeType() {
    return window$1.SourceBuffer && window$1.SourceBuffer.prototype && typeof window$1.SourceBuffer.prototype.changeType === 'function';
  }
  /**
   * Whether or not the changeType function is supported
   * on our SourceBuffers.
   *
   * @return {boolean}
   *         if changeType can be called.
   */
  ;

  _proto.canChangeType = function canChangeType() {
    return this.constructor.canChangeType();
  }
  /**
   * Call the changeType function on a source buffer, given the code and type.
   *
   * @param {string} type
   *        The type of source buffer to call changeType on.
   *
   * @param {string} codec
   *        The codec string to change type with on the source buffer.
   */
  ;

  _proto.changeType = function changeType(type, codec) {
    if (!this.canChangeType()) {
      videojs.log.error('changeType is not supported!');
      return;
    }

    pushQueue({
      type: type,
      sourceUpdater: this,
      action: actions.changeType(codec),
      name: 'changeType'
    });
  }
  /**
   * Add source buffers with a codec or, if they are already created,
   * call changeType on source buffers using changeType.
   *
   * @param {Object} codecs
   *        Codecs to switch to
   */
  ;

  _proto.addOrChangeSourceBuffers = function addOrChangeSourceBuffers(codecs) {
    var _this2 = this;

    if (!codecs || typeof codecs !== 'object' || Object.keys(codecs).length === 0) {
      throw new Error('Cannot addOrChangeSourceBuffers to undefined codecs');
    }

    Object.keys(codecs).forEach(function (type) {
      var codec = codecs[type];

      if (!_this2.hasCreatedSourceBuffers()) {
        return _this2.addSourceBuffer(type, codec);
      }

      if (_this2.canChangeType()) {
        _this2.changeType(type, codec);
      }
    });
  }
  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {MediaObject} object containing audioBytes and/or videoBytes
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  ;

  _proto.appendBuffer = function appendBuffer(options, doneFn) {
    var _this3 = this;

    var segmentInfo = options.segmentInfo,
        type = options.type,
        bytes = options.bytes;
    this.processedAppend_ = true;

    if (type === 'audio' && this.videoBuffer && !this.videoAppendQueued_) {
      this.delayedAudioAppendQueue_.push([options, doneFn]);
      this.logger_("delayed audio append of " + bytes.length + " until video append");
      return;
    } // In the case of certain errors, for instance, QUOTA_EXCEEDED_ERR, updateend will
    // not be fired. This means that the queue will be blocked until the next action
    // taken by the segment-loader. Provide a mechanism for segment-loader to handle
    // these errors by calling the doneFn with the specific error.


    var onError = doneFn;
    pushQueue({
      type: type,
      sourceUpdater: this,
      action: actions.appendBuffer(bytes, segmentInfo || {
        mediaIndex: -1
      }, onError),
      doneFn: doneFn,
      name: 'appendBuffer'
    });

    if (type === 'video') {
      this.videoAppendQueued_ = true;

      if (!this.delayedAudioAppendQueue_.length) {
        return;
      }

      var queue = this.delayedAudioAppendQueue_.slice();
      this.logger_("queuing delayed audio " + queue.length + " appendBuffers");
      this.delayedAudioAppendQueue_.length = 0;
      queue.forEach(function (que) {
        _this3.appendBuffer.apply(_this3, que);
      });
    }
  }
  /**
   * Get the audio buffer's buffered timerange.
   *
   * @return {TimeRange}
   *         The audio buffer's buffered time range
   */
  ;

  _proto.audioBuffered = function audioBuffered() {
    // no media source/source buffer or it isn't in the media sources
    // source buffer list
    if (!inSourceBuffers(this.mediaSource, this.audioBuffer)) {
      return createTimeRanges();
    }

    return this.audioBuffer.buffered ? this.audioBuffer.buffered : createTimeRanges();
  }
  /**
   * Get the video buffer's buffered timerange.
   *
   * @return {TimeRange}
   *         The video buffer's buffered time range
   */
  ;

  _proto.videoBuffered = function videoBuffered() {
    // no media source/source buffer or it isn't in the media sources
    // source buffer list
    if (!inSourceBuffers(this.mediaSource, this.videoBuffer)) {
      return createTimeRanges();
    }

    return this.videoBuffer.buffered ? this.videoBuffer.buffered : createTimeRanges();
  }
  /**
   * Get a combined video/audio buffer's buffered timerange.
   *
   * @return {TimeRange}
   *         the combined time range
   */
  ;

  _proto.buffered = function buffered() {
    var video = inSourceBuffers(this.mediaSource, this.videoBuffer) ? this.videoBuffer : null;
    var audio = inSourceBuffers(this.mediaSource, this.audioBuffer) ? this.audioBuffer : null;

    if (audio && !video) {
      return this.audioBuffered();
    }

    if (video && !audio) {
      return this.videoBuffered();
    }

    return bufferIntersection(this.audioBuffered(), this.videoBuffered());
  }
  /**
   * Add a callback to the queue that will set duration on the mediaSource.
   *
   * @param {number} duration
   *        The duration to set
   *
   * @param {Function} [doneFn]
   *        function to run after duration has been set.
   */
  ;

  _proto.setDuration = function setDuration(duration, doneFn) {
    if (doneFn === void 0) {
      doneFn = noop;
    }

    // In order to set the duration on the media source, it's necessary to wait for all
    // source buffers to no longer be updating. "If the updating attribute equals true on
    // any SourceBuffer in sourceBuffers, then throw an InvalidStateError exception and
    // abort these steps." (source: https://www.w3.org/TR/media-source/#attributes).
    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.duration(duration),
      name: 'duration',
      doneFn: doneFn
    });
  }
  /**
   * Add a mediaSource endOfStream call to the queue
   *
   * @param {Error} [error]
   *        Call endOfStream with an error
   *
   * @param {Function} [doneFn]
   *        A function that should be called when the
   *        endOfStream call has finished.
   */
  ;

  _proto.endOfStream = function endOfStream(error, doneFn) {
    if (error === void 0) {
      error = null;
    }

    if (doneFn === void 0) {
      doneFn = noop;
    }

    if (typeof error !== 'string') {
      error = undefined;
    } // In order to set the duration on the media source, it's necessary to wait for all
    // source buffers to no longer be updating. "If the updating attribute equals true on
    // any SourceBuffer in sourceBuffers, then throw an InvalidStateError exception and
    // abort these steps." (source: https://www.w3.org/TR/media-source/#attributes).


    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.endOfStream(error),
      name: 'endOfStream',
      doneFn: doneFn
    });
  }
  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {number} start where to start the removal
   * @param {number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  ;

  _proto.removeAudio = function removeAudio(start, end, done) {
    if (done === void 0) {
      done = noop;
    }

    if (!this.audioBuffered().length || this.audioBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue({
      type: 'audio',
      sourceUpdater: this,
      action: actions.remove(start, end),
      doneFn: done,
      name: 'remove'
    });
  }
  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {number} start where to start the removal
   * @param {number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  ;

  _proto.removeVideo = function removeVideo(start, end, done) {
    if (done === void 0) {
      done = noop;
    }

    if (!this.videoBuffered().length || this.videoBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue({
      type: 'video',
      sourceUpdater: this,
      action: actions.remove(start, end),
      doneFn: done,
      name: 'remove'
    });
  }
  /**
   * Whether the underlying sourceBuffer is updating or not
   *
   * @return {boolean} the updating status of the SourceBuffer
   */
  ;

  _proto.updating = function updating() {
    // the audio/video source buffer is updating
    if (_updating('audio', this) || _updating('video', this)) {
      return true;
    }

    return false;
  }
  /**
   * Set/get the timestampoffset on the audio SourceBuffer
   *
   * @return {number} the timestamp offset
   */
  ;

  _proto.audioTimestampOffset = function audioTimestampOffset(offset) {
    if (typeof offset !== 'undefined' && this.audioBuffer && // no point in updating if it's the same
    this.audioTimestampOffset_ !== offset) {
      pushQueue({
        type: 'audio',
        sourceUpdater: this,
        action: actions.timestampOffset(offset),
        name: 'timestampOffset'
      });
      this.audioTimestampOffset_ = offset;
    }

    return this.audioTimestampOffset_;
  }
  /**
   * Set/get the timestampoffset on the video SourceBuffer
   *
   * @return {number} the timestamp offset
   */
  ;

  _proto.videoTimestampOffset = function videoTimestampOffset(offset) {
    if (typeof offset !== 'undefined' && this.videoBuffer && // no point in updating if it's the same
    this.videoTimestampOffset !== offset) {
      pushQueue({
        type: 'video',
        sourceUpdater: this,
        action: actions.timestampOffset(offset),
        name: 'timestampOffset'
      });
      this.videoTimestampOffset_ = offset;
    }

    return this.videoTimestampOffset_;
  }
  /**
   * Add a function to the queue that will be called
   * when it is its turn to run in the audio queue.
   *
   * @param {Function} callback
   *        The callback to queue.
   */
  ;

  _proto.audioQueueCallback = function audioQueueCallback(callback) {
    if (!this.audioBuffer) {
      return;
    }

    pushQueue({
      type: 'audio',
      sourceUpdater: this,
      action: actions.callback(callback),
      name: 'callback'
    });
  }
  /**
   * Add a function to the queue that will be called
   * when it is its turn to run in the video queue.
   *
   * @param {Function} callback
   *        The callback to queue.
   */
  ;

  _proto.videoQueueCallback = function videoQueueCallback(callback) {
    if (!this.videoBuffer) {
      return;
    }

    pushQueue({
      type: 'video',
      sourceUpdater: this,
      action: actions.callback(callback),
      name: 'callback'
    });
  }
  /**
   * dispose of the source updater and the underlying sourceBuffer
   */
  ;

  _proto.dispose = function dispose() {
    var _this4 = this;

    this.trigger('dispose');
    bufferTypes.forEach(function (type) {
      _this4.abort(type);

      if (_this4.canRemoveSourceBuffer()) {
        _this4.removeSourceBuffer(type);
      } else {
        _this4[type + "QueueCallback"](function () {
          return cleanupBuffer(type, _this4);
        });
      }
    });
    this.videoAppendQueued_ = false;
    this.delayedAudioAppendQueue_.length = 0;

    if (this.sourceopenListener_) {
      this.mediaSource.removeEventListener('sourceopen', this.sourceopenListener_);
    }

    this.off();
  };

  return SourceUpdater;
}(videojs.EventTarget);

var uint8ToUtf8 = function uint8ToUtf8(uintArray) {
  return decodeURIComponent(escape(String.fromCharCode.apply(null, uintArray)));
};
var bufferToHexString = function bufferToHexString(buffer) {
  var uInt8Buffer = new Uint8Array(buffer);
  return Array.from(uInt8Buffer).map(function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
};

var VTT_LINE_TERMINATORS = new Uint8Array('\n\n'.split('').map(function (char) {
  return char.charCodeAt(0);
}));

var NoVttJsError = /*#__PURE__*/function (_Error) {
  _inheritsLoose(NoVttJsError, _Error);

  function NoVttJsError() {
    return _Error.call(this, 'Trying to parse received VTT cues, but there is no WebVTT. Make sure vtt.js is loaded.') || this;
  }

  return NoVttJsError;
}( /*#__PURE__*/_wrapNativeSuper(Error));
/**
 * An object that manages segment loading and appending.
 *
 * @class VTTSegmentLoader
 * @param {Object} options required and optional options
 * @extends videojs.EventTarget
 */


var VTTSegmentLoader = /*#__PURE__*/function (_SegmentLoader) {
  _inheritsLoose(VTTSegmentLoader, _SegmentLoader);

  function VTTSegmentLoader(settings, options) {
    var _this;

    if (options === void 0) {
      options = {};
    }

    _this = _SegmentLoader.call(this, settings, options) || this; // SegmentLoader requires a MediaSource be specified or it will throw an error;
    // however, VTTSegmentLoader has no need of a media source, so delete the reference

    _this.mediaSource_ = null;
    _this.subtitlesTrack_ = null;
    _this.featuresNativeTextTracks_ = settings.featuresNativeTextTracks;
    _this.loadVttJs = settings.loadVttJs; // The VTT segment will have its own time mappings. Saving VTT segment timing info in
    // the sync controller leads to improper behavior.

    _this.shouldSaveSegmentTimingInfo_ = false;
    return _this;
  }

  var _proto = VTTSegmentLoader.prototype;

  _proto.createTransmuxer_ = function createTransmuxer_() {
    // don't need to transmux any subtitles
    return null;
  }
  /**
   * Indicates which time ranges are buffered
   *
   * @return {TimeRange}
   *         TimeRange object representing the current buffered ranges
   */
  ;

  _proto.buffered_ = function buffered_() {
    if (!this.subtitlesTrack_ || !this.subtitlesTrack_.cues || !this.subtitlesTrack_.cues.length) {
      return createTimeRanges();
    }

    var cues = this.subtitlesTrack_.cues;
    var start = cues[0].startTime;
    var end = cues[cues.length - 1].startTime;
    return createTimeRanges([[start, end]]);
  }
  /**
   * Gets and sets init segment for the provided map
   *
   * @param {Object} map
   *        The map object representing the init segment to get or set
   * @param {boolean=} set
   *        If true, the init segment for the provided map should be saved
   * @return {Object}
   *         map object for desired init segment
   */
  ;

  _proto.initSegmentForMap = function initSegmentForMap(map, set) {
    if (set === void 0) {
      set = false;
    }

    if (!map) {
      return null;
    }

    var id = initSegmentId(map);
    var storedMap = this.initSegments_[id];

    if (set && !storedMap && map.bytes) {
      // append WebVTT line terminators to the media initialization segment if it exists
      // to follow the WebVTT spec (https://w3c.github.io/webvtt/#file-structure) that
      // requires two or more WebVTT line terminators between the WebVTT header and the
      // rest of the file
      var combinedByteLength = VTT_LINE_TERMINATORS.byteLength + map.bytes.byteLength;
      var combinedSegment = new Uint8Array(combinedByteLength);
      combinedSegment.set(map.bytes);
      combinedSegment.set(VTT_LINE_TERMINATORS, map.bytes.byteLength);
      this.initSegments_[id] = storedMap = {
        resolvedUri: map.resolvedUri,
        byterange: map.byterange,
        bytes: combinedSegment
      };
    }

    return storedMap || map;
  }
  /**
   * Returns true if all configuration required for loading is present, otherwise false.
   *
   * @return {boolean} True if the all configuration is ready for loading
   * @private
   */
  ;

  _proto.couldBeginLoading_ = function couldBeginLoading_() {
    return this.playlist_ && this.subtitlesTrack_ && !this.paused();
  }
  /**
   * Once all the starting parameters have been specified, begin
   * operation. This method should only be invoked from the INIT
   * state.
   *
   * @private
   */
  ;

  _proto.init_ = function init_() {
    this.state = 'READY';
    this.resetEverything();
    return this.monitorBuffer_();
  }
  /**
   * Set a subtitle track on the segment loader to add subtitles to
   *
   * @param {TextTrack=} track
   *        The text track to add loaded subtitles to
   * @return {TextTrack}
   *        Returns the subtitles track
   */
  ;

  _proto.track = function track(_track) {
    if (typeof _track === 'undefined') {
      return this.subtitlesTrack_;
    }

    this.subtitlesTrack_ = _track; // if we were unpaused but waiting for a sourceUpdater, start
    // buffering now

    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      this.init_();
    }

    return this.subtitlesTrack_;
  }
  /**
   * Remove any data in the source buffer between start and end times
   *
   * @param {number} start - the start time of the region to remove from the buffer
   * @param {number} end - the end time of the region to remove from the buffer
   */
  ;

  _proto.remove = function remove(start, end) {
    removeCuesFromTrack(start, end, this.subtitlesTrack_);
  }
  /**
   * fill the buffer with segements unless the sourceBuffers are
   * currently updating
   *
   * Note: this function should only ever be called by monitorBuffer_
   * and never directly
   *
   * @private
   */
  ;

  _proto.fillBuffer_ = function fillBuffer_() {
    var _this2 = this;

    // see if we need to begin loading immediately
    var segmentInfo = this.chooseNextRequest_();

    if (!segmentInfo) {
      return;
    }

    if (this.syncController_.timestampOffsetForTimeline(segmentInfo.timeline) === null) {
      // We don't have the timestamp offset that we need to sync subtitles.
      // Rerun on a timestamp offset or user interaction.
      var checkTimestampOffset = function checkTimestampOffset() {
        _this2.state = 'READY';

        if (!_this2.paused()) {
          // if not paused, queue a buffer check as soon as possible
          _this2.monitorBuffer_();
        }
      };

      this.syncController_.one('timestampoffset', checkTimestampOffset);
      this.state = 'WAITING_ON_TIMELINE';
      return;
    }

    this.loadSegment_(segmentInfo);
  } // never set a timestamp offset for vtt segments.
  ;

  _proto.timestampOffsetForSegment_ = function timestampOffsetForSegment_() {
    return null;
  };

  _proto.chooseNextRequest_ = function chooseNextRequest_() {
    return this.skipEmptySegments_(_SegmentLoader.prototype.chooseNextRequest_.call(this));
  }
  /**
   * Prevents the segment loader from requesting segments we know contain no subtitles
   * by walking forward until we find the next segment that we don't know whether it is
   * empty or not.
   *
   * @param {Object} segmentInfo
   *        a segment info object that describes the current segment
   * @return {Object}
   *         a segment info object that describes the current segment
   */
  ;

  _proto.skipEmptySegments_ = function skipEmptySegments_(segmentInfo) {
    while (segmentInfo && segmentInfo.segment.empty) {
      // stop at the last possible segmentInfo
      if (segmentInfo.mediaIndex + 1 >= segmentInfo.playlist.segments.length) {
        segmentInfo = null;
        break;
      }

      segmentInfo = this.generateSegmentInfo_({
        playlist: segmentInfo.playlist,
        mediaIndex: segmentInfo.mediaIndex + 1,
        startOfSegment: segmentInfo.startOfSegment + segmentInfo.duration,
        isSyncRequest: segmentInfo.isSyncRequest
      });
    }

    return segmentInfo;
  };

  _proto.stopForError = function stopForError(error) {
    this.error(error);
    this.state = 'READY';
    this.pause();
    this.trigger('error');
  }
  /**
   * append a decrypted segement to the SourceBuffer through a SourceUpdater
   *
   * @private
   */
  ;

  _proto.segmentRequestFinished_ = function segmentRequestFinished_(error, simpleSegment, result) {
    var _this3 = this;

    if (!this.subtitlesTrack_) {
      this.state = 'READY';
      return;
    }

    this.saveTransferStats_(simpleSegment.stats); // the request was aborted

    if (!this.pendingSegment_) {
      this.state = 'READY';
      this.mediaRequestsAborted += 1;
      return;
    }

    if (error) {
      if (error.code === REQUEST_ERRORS.TIMEOUT) {
        this.handleTimeout_();
      }

      if (error.code === REQUEST_ERRORS.ABORTED) {
        this.mediaRequestsAborted += 1;
      } else {
        this.mediaRequestsErrored += 1;
      }

      this.stopForError(error);
      return;
    }

    var segmentInfo = this.pendingSegment_; // although the VTT segment loader bandwidth isn't really used, it's good to
    // maintain functionality between segment loaders

    this.saveBandwidthRelatedStats_(segmentInfo.duration, simpleSegment.stats); // if this request included a segment key, save that data in the cache

    if (simpleSegment.key) {
      this.segmentKey(simpleSegment.key, true);
    }

    this.state = 'APPENDING'; // used for tests

    this.trigger('appending');
    var segment = segmentInfo.segment;

    if (segment.map) {
      segment.map.bytes = simpleSegment.map.bytes;
    }

    segmentInfo.bytes = simpleSegment.bytes; // Make sure that vttjs has loaded, otherwise, load it and wait till it finished loading

    if (typeof window$1.WebVTT !== 'function' && typeof this.loadVttJs === 'function') {
      this.state = 'WAITING_ON_VTTJS'; // should be fine to call multiple times
      // script will be loaded once but multiple listeners will be added to the queue, which is expected.

      this.loadVttJs().then(function () {
        return _this3.segmentRequestFinished_(error, simpleSegment, result);
      }, function () {
        return _this3.stopForError({
          message: 'Error loading vtt.js',
          metadata: {
            errorType: videojs.Error.VttLoadError
          }
        });
      });
      return;
    }

    segment.requested = true;

    try {
      this.parseVTTCues_(segmentInfo);
    } catch (e) {
      this.stopForError({
        message: e.message,
        metadata: {
          errorType: videojs.Error.VttCueParsingError
        }
      });
      return;
    }

    this.updateTimeMapping_(segmentInfo, this.syncController_.timelines[segmentInfo.timeline], this.playlist_);

    if (segmentInfo.cues.length) {
      segmentInfo.timingInfo = {
        start: segmentInfo.cues[0].startTime,
        end: segmentInfo.cues[segmentInfo.cues.length - 1].endTime
      };
    } else {
      segmentInfo.timingInfo = {
        start: segmentInfo.startOfSegment,
        end: segmentInfo.startOfSegment + segmentInfo.duration
      };
    }

    if (segmentInfo.isSyncRequest) {
      this.trigger('syncinfoupdate');
      this.pendingSegment_ = null;
      this.state = 'READY';
      return;
    }

    segmentInfo.byteLength = segmentInfo.bytes.byteLength;
    this.mediaSecondsLoaded += segment.duration; // Create VTTCue instances for each cue in the new segment and add them to
    // the subtitle track

    segmentInfo.cues.forEach(function (cue) {
      _this3.subtitlesTrack_.addCue(_this3.featuresNativeTextTracks_ ? new window$1.VTTCue(cue.startTime, cue.endTime, cue.text) : cue);
    }); // Remove any duplicate cues from the subtitle track. The WebVTT spec allows
    // cues to have identical time-intervals, but if the text is also identical
    // we can safely assume it is a duplicate that can be removed (ex. when a cue
    // "overlaps" VTT segments)

    removeDuplicateCuesFromTrack(this.subtitlesTrack_);
    this.handleAppendsDone_();
  };

  _proto.handleData_ = function handleData_() {// noop as we shouldn't be getting video/audio data captions
    // that we do not support here.
  };

  _proto.updateTimingInfoEnd_ = function updateTimingInfoEnd_() {// noop
  }
  /**
   * Uses the WebVTT parser to parse the segment response
   *
   * @throws NoVttJsError
   *
   * @param {Object} segmentInfo
   *        a segment info object that describes the current segment
   * @private
   */
  ;

  _proto.parseVTTCues_ = function parseVTTCues_(segmentInfo) {
    var decoder;
    var decodeBytesToString = false;

    if (typeof window$1.WebVTT !== 'function') {
      // caller is responsible for exception handling.
      throw new NoVttJsError();
    }

    if (typeof window$1.TextDecoder === 'function') {
      decoder = new window$1.TextDecoder('utf8');
    } else {
      decoder = window$1.WebVTT.StringDecoder();
      decodeBytesToString = true;
    }

    var parser = new window$1.WebVTT.Parser(window$1, window$1.vttjs, decoder);
    segmentInfo.cues = [];
    segmentInfo.timestampmap = {
      MPEGTS: 0,
      LOCAL: 0
    };
    parser.oncue = segmentInfo.cues.push.bind(segmentInfo.cues);

    parser.ontimestampmap = function (map) {
      segmentInfo.timestampmap = map;
    };

    parser.onparsingerror = function (error) {
      videojs.log.warn('Error encountered when parsing cues: ' + error.message);
    };

    if (segmentInfo.segment.map) {
      var mapData = segmentInfo.segment.map.bytes;

      if (decodeBytesToString) {
        mapData = uint8ToUtf8(mapData);
      }

      parser.parse(mapData);
    }

    var segmentData = segmentInfo.bytes;

    if (decodeBytesToString) {
      segmentData = uint8ToUtf8(segmentData);
    }

    parser.parse(segmentData);
    parser.flush();
  }
  /**
   * Updates the start and end times of any cues parsed by the WebVTT parser using
   * the information parsed from the X-TIMESTAMP-MAP header and a TS to media time mapping
   * from the SyncController
   *
   * @param {Object} segmentInfo
   *        a segment info object that describes the current segment
   * @param {Object} mappingObj
   *        object containing a mapping from TS to media time
   * @param {Object} playlist
   *        the playlist object containing the segment
   * @private
   */
  ;

  _proto.updateTimeMapping_ = function updateTimeMapping_(segmentInfo, mappingObj, playlist) {
    var _this4 = this;

    var segment = segmentInfo.segment;

    if (!mappingObj) {
      // If the sync controller does not have a mapping of TS to Media Time for the
      // timeline, then we don't have enough information to update the cue
      // start/end times
      return;
    }

    if (!segmentInfo.cues.length) {
      // If there are no cues, we also do not have enough information to figure out
      // segment timing. Mark that the segment contains no cues so we don't re-request
      // an empty segment.
      segment.empty = true;
      return;
    }

    var _segmentInfo$timestam = segmentInfo.timestampmap,
        MPEGTS = _segmentInfo$timestam.MPEGTS,
        LOCAL = _segmentInfo$timestam.LOCAL;
    /**
     * From the spec:
     * The MPEGTS media timestamp MUST use a 90KHz timescale,
     * even when non-WebVTT Media Segments use a different timescale.
     */

    var mpegTsInSeconds = MPEGTS / ONE_SECOND_IN_TS;
    var diff = mpegTsInSeconds - LOCAL + mappingObj.mapping;
    segmentInfo.cues.forEach(function (cue) {
      var duration = cue.endTime - cue.startTime;
      var startTime = MPEGTS === 0 ? cue.startTime + diff : _this4.handleRollover_(cue.startTime + diff, mappingObj.time);
      cue.startTime = Math.max(startTime, 0);
      cue.endTime = Math.max(startTime + duration, 0);
    });

    if (!playlist.syncInfo) {
      var firstStart = segmentInfo.cues[0].startTime;
      var lastStart = segmentInfo.cues[segmentInfo.cues.length - 1].startTime;
      playlist.syncInfo = {
        mediaSequence: playlist.mediaSequence + segmentInfo.mediaIndex,
        time: Math.min(firstStart, lastStart - segment.duration)
      };
    }
  }
  /**
   * MPEG-TS PES timestamps are limited to 2^33.
   * Once they reach 2^33, they roll over to 0.
   * mux.js handles PES timestamp rollover for the following scenarios:
   * [forward rollover(right)] ->
   *    PES timestamps monotonically increase, and once they reach 2^33, they roll over to 0
   * [backward rollover(left)] -->
   *    we seek back to position before rollover.
   *
   * According to the HLS SPEC:
   * When synchronizing WebVTT with PES timestamps, clients SHOULD account
   * for cases where the 33-bit PES timestamps have wrapped and the WebVTT
   * cue times have not.  When the PES timestamp wraps, the WebVTT Segment
   * SHOULD have a X-TIMESTAMP-MAP header that maps the current WebVTT
   * time to the new (low valued) PES timestamp.
   *
   * So we want to handle rollover here and align VTT Cue start/end time to the player's time.
   */
  ;

  _proto.handleRollover_ = function handleRollover_(value, reference) {
    if (reference === null) {
      return value;
    }

    var valueIn90khz = value * ONE_SECOND_IN_TS;
    var referenceIn90khz = reference * ONE_SECOND_IN_TS;
    var offset;

    if (referenceIn90khz < valueIn90khz) {
      // - 2^33
      offset = -8589934592;
    } else {
      // + 2^33
      offset = 8589934592;
    } // distance(value - reference) > 2^32


    while (Math.abs(valueIn90khz - referenceIn90khz) > 4294967296) {
      valueIn90khz += offset;
    }

    return valueIn90khz / ONE_SECOND_IN_TS;
  };

  return VTTSegmentLoader;
}(SegmentLoader);

/**
 * @file ad-cue-tags.js
 */
/**
 * Searches for an ad cue that overlaps with the given mediaTime
 *
 * @param {Object} track
 *        the track to find the cue for
 *
 * @param {number} mediaTime
 *        the time to find the cue at
 *
 * @return {Object|null}
 *         the found cue or null
 */

var findAdCue = function findAdCue(track, mediaTime) {
  var cues = track.cues;

  for (var i = 0; i < cues.length; i++) {
    var cue = cues[i];

    if (mediaTime >= cue.adStartTime && mediaTime <= cue.adEndTime) {
      return cue;
    }
  }

  return null;
};
var updateAdCues = function updateAdCues(media, track, offset) {
  if (offset === void 0) {
    offset = 0;
  }

  if (!media.segments) {
    return;
  }

  var mediaTime = offset;
  var cue;

  for (var i = 0; i < media.segments.length; i++) {
    var segment = media.segments[i];

    if (!cue) {
      // Since the cues will span for at least the segment duration, adding a fudge
      // factor of half segment duration will prevent duplicate cues from being
      // created when timing info is not exact (e.g. cue start time initialized
      // at 10.006677, but next call mediaTime is 10.003332 )
      cue = findAdCue(track, mediaTime + segment.duration / 2);
    }

    if (cue) {
      if ('cueIn' in segment) {
        // Found a CUE-IN so end the cue
        cue.endTime = mediaTime;
        cue.adEndTime = mediaTime;
        mediaTime += segment.duration;
        cue = null;
        continue;
      }

      if (mediaTime < cue.endTime) {
        // Already processed this mediaTime for this cue
        mediaTime += segment.duration;
        continue;
      } // otherwise extend cue until a CUE-IN is found


      cue.endTime += segment.duration;
    } else {
      if ('cueOut' in segment) {
        cue = new window$1.VTTCue(mediaTime, mediaTime + segment.duration, segment.cueOut);
        cue.adStartTime = mediaTime; // Assumes tag format to be
        // #EXT-X-CUE-OUT:30

        cue.adEndTime = mediaTime + parseFloat(segment.cueOut);
        track.addCue(cue);
      }

      if ('cueOutCont' in segment) {
        // Entered into the middle of an ad cue
        // Assumes tag formate to be
        // #EXT-X-CUE-OUT-CONT:10/30
        var _segment$cueOutCont$s = segment.cueOutCont.split('/').map(parseFloat),
            adOffset = _segment$cueOutCont$s[0],
            adTotal = _segment$cueOutCont$s[1];

        cue = new window$1.VTTCue(mediaTime, mediaTime + segment.duration, '');
        cue.adStartTime = mediaTime - adOffset;
        cue.adEndTime = cue.adStartTime + adTotal;
        track.addCue(cue);
      }
    }

    mediaTime += segment.duration;
  }
};

function _createForOfIteratorHelperLoose$3(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (it) return (it = it.call(o)).next.bind(it); if (Array.isArray(o) || (it = _unsupportedIterableToArray$3(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; return function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray$3(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray$3(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$3(o, minLen); }

function _arrayLikeToArray$3(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

var SyncInfo = /*#__PURE__*/function () {
  /**
   * @param {number} start - media sequence start
   * @param {number} end - media sequence end
   * @param {number} segmentIndex - index for associated segment
   * @param {number|null} [partIndex] - index for associated part
   * @param {boolean} [appended] - appended indicator
   *
   */
  function SyncInfo(_ref) {
    var start = _ref.start,
        end = _ref.end,
        segmentIndex = _ref.segmentIndex,
        _ref$partIndex = _ref.partIndex,
        partIndex = _ref$partIndex === void 0 ? null : _ref$partIndex,
        _ref$appended = _ref.appended,
        appended = _ref$appended === void 0 ? false : _ref$appended;
    this.start_ = start;
    this.end_ = end;
    this.segmentIndex_ = segmentIndex;
    this.partIndex_ = partIndex;
    this.appended_ = appended;
  }

  var _proto = SyncInfo.prototype;

  _proto.isInRange = function isInRange(targetTime) {
    return targetTime >= this.start && targetTime < this.end;
  };

  _proto.markAppended = function markAppended() {
    this.appended_ = true;
  };

  _proto.resetAppendedStatus = function resetAppendedStatus() {
    this.appended_ = false;
  };

  _createClass(SyncInfo, [{
    key: "isAppended",
    get: function get() {
      return this.appended_;
    }
  }, {
    key: "start",
    get: function get() {
      return this.start_;
    }
  }, {
    key: "end",
    get: function get() {
      return this.end_;
    }
  }, {
    key: "segmentIndex",
    get: function get() {
      return this.segmentIndex_;
    }
  }, {
    key: "partIndex",
    get: function get() {
      return this.partIndex_;
    }
  }]);

  return SyncInfo;
}();

var SyncInfoData = /*#__PURE__*/function () {
  /**
   *
   * @param {SyncInfo} segmentSyncInfo - sync info for a given segment
   * @param {Array<SyncInfo>} [partsSyncInfo] - sync infos for a list of parts for a given segment
   */
  function SyncInfoData(segmentSyncInfo, partsSyncInfo) {
    if (partsSyncInfo === void 0) {
      partsSyncInfo = [];
    }

    this.segmentSyncInfo_ = segmentSyncInfo;
    this.partsSyncInfo_ = partsSyncInfo;
  }

  var _proto2 = SyncInfoData.prototype;

  _proto2.resetAppendStatus = function resetAppendStatus() {
    this.segmentSyncInfo_.resetAppendedStatus();
    this.partsSyncInfo_.forEach(function (partSyncInfo) {
      return partSyncInfo.resetAppendedStatus();
    });
  };

  _createClass(SyncInfoData, [{
    key: "segmentSyncInfo",
    get: function get() {
      return this.segmentSyncInfo_;
    }
  }, {
    key: "partsSyncInfo",
    get: function get() {
      return this.partsSyncInfo_;
    }
  }, {
    key: "hasPartsSyncInfo",
    get: function get() {
      return this.partsSyncInfo_.length > 0;
    }
  }]);

  return SyncInfoData;
}();

var MediaSequenceSync = /*#__PURE__*/function () {
  function MediaSequenceSync() {
    /**
     * @type {Map<number, SyncInfoData>}
     * @protected
     */
    this.storage_ = new Map();
    this.diagnostics_ = '';
    this.isReliable_ = false;
    this.start_ = -Infinity;
    this.end_ = Infinity;
  }

  var _proto3 = MediaSequenceSync.prototype;

  _proto3.resetAppendedStatus = function resetAppendedStatus() {
    this.storage_.forEach(function (syncInfoData) {
      return syncInfoData.resetAppendStatus();
    });
  }
  /**
   * update sync storage
   *
   * @param {Object} playlist
   * @param {number} currentTime
   *
   * @return {void}
   */
  ;

  _proto3.update = function update(playlist, currentTime) {
    var mediaSequence = playlist.mediaSequence,
        segments = playlist.segments;
    this.isReliable_ = this.isReliablePlaylist_(mediaSequence, segments);

    if (!this.isReliable_) {
      return;
    }

    return this.updateStorage_(segments, mediaSequence, this.calculateBaseTime_(mediaSequence, currentTime));
  }
  /**
   * @param {number} targetTime
   * @return {SyncInfo|null}
   */
  ;

  _proto3.getSyncInfoForTime = function getSyncInfoForTime(targetTime) {
    for (var _iterator = _createForOfIteratorHelperLoose$3(this.storage_.values()), _step; !(_step = _iterator()).done;) {
      var _step$value = _step.value,
          segmentSyncInfo = _step$value.segmentSyncInfo,
          partsSyncInfo = _step$value.partsSyncInfo;

      // Normal segment flow:
      if (!partsSyncInfo.length) {
        if (segmentSyncInfo.isInRange(targetTime)) {
          return segmentSyncInfo;
        }
      } else {
        // Low latency flow:
        for (var _iterator2 = _createForOfIteratorHelperLoose$3(partsSyncInfo), _step2; !(_step2 = _iterator2()).done;) {
          var partSyncInfo = _step2.value;

          if (partSyncInfo.isInRange(targetTime)) {
            return partSyncInfo;
          }
        }
      }
    }

    return null;
  };

  _proto3.getSyncInfoForMediaSequence = function getSyncInfoForMediaSequence(mediaSequence) {
    return this.storage_.get(mediaSequence);
  };

  _proto3.updateStorage_ = function updateStorage_(segments, startingMediaSequence, startingTime) {
    var _this = this;

    var newStorage = new Map();
    var newDiagnostics = '\n';
    var currentStart = startingTime;
    var currentMediaSequence = startingMediaSequence;
    this.start_ = currentStart;
    segments.forEach(function (segment, segmentIndex) {
      var prevSyncInfoData = _this.storage_.get(currentMediaSequence);

      var segmentStart = currentStart;
      var segmentEnd = segmentStart + segment.duration;
      var segmentIsAppended = Boolean(prevSyncInfoData && prevSyncInfoData.segmentSyncInfo && prevSyncInfoData.segmentSyncInfo.isAppended);
      var segmentSyncInfo = new SyncInfo({
        start: segmentStart,
        end: segmentEnd,
        appended: segmentIsAppended,
        segmentIndex: segmentIndex
      });
      segment.syncInfo = segmentSyncInfo;
      var currentPartStart = currentStart;
      var partsSyncInfo = (segment.parts || []).map(function (part, partIndex) {
        var partStart = currentPartStart;
        var partEnd = currentPartStart + part.duration;
        var partIsAppended = Boolean(prevSyncInfoData && prevSyncInfoData.partsSyncInfo && prevSyncInfoData.partsSyncInfo[partIndex] && prevSyncInfoData.partsSyncInfo[partIndex].isAppended);
        var partSyncInfo = new SyncInfo({
          start: partStart,
          end: partEnd,
          appended: partIsAppended,
          segmentIndex: segmentIndex,
          partIndex: partIndex
        });
        currentPartStart = partEnd;
        newDiagnostics += "Media Sequence: " + currentMediaSequence + "." + partIndex + " | Range: " + partStart + " --> " + partEnd + " | Appended: " + partIsAppended + "\n";
        part.syncInfo = partSyncInfo;
        return partSyncInfo;
      });
      newStorage.set(currentMediaSequence, new SyncInfoData(segmentSyncInfo, partsSyncInfo));
      newDiagnostics += compactSegmentUrlDescription(segment.resolvedUri) + " | Media Sequence: " + currentMediaSequence + " | Range: " + segmentStart + " --> " + segmentEnd + " | Appended: " + segmentIsAppended + "\n";
      currentMediaSequence++;
      currentStart = segmentEnd;
    });
    this.end_ = currentStart;
    this.storage_ = newStorage;
    this.diagnostics_ = newDiagnostics;
  };

  _proto3.calculateBaseTime_ = function calculateBaseTime_(mediaSequence, fallback) {
    if (!this.storage_.size) {
      // Initial setup flow.
      return 0;
    }

    if (this.storage_.has(mediaSequence)) {
      // Normal flow.
      return this.storage_.get(mediaSequence).segmentSyncInfo.start;
    } // Fallback flow.
    // There is a gap between last recorded playlist and a new one received.


    return fallback;
  };

  _proto3.isReliablePlaylist_ = function isReliablePlaylist_(mediaSequence, segments) {
    return mediaSequence !== undefined && mediaSequence !== null && Array.isArray(segments) && segments.length;
  };

  _createClass(MediaSequenceSync, [{
    key: "start",
    get: function get() {
      return this.start_;
    }
  }, {
    key: "end",
    get: function get() {
      return this.end_;
    }
  }, {
    key: "diagnostics",
    get: function get() {
      return this.diagnostics_;
    }
  }, {
    key: "isReliable",
    get: function get() {
      return this.isReliable_;
    }
  }]);

  return MediaSequenceSync;
}();
var DependantMediaSequenceSync = /*#__PURE__*/function (_MediaSequenceSync) {
  _inheritsLoose(DependantMediaSequenceSync, _MediaSequenceSync);

  function DependantMediaSequenceSync(parent) {
    var _this2;

    _this2 = _MediaSequenceSync.call(this) || this;
    _this2.parent_ = parent;
    return _this2;
  }

  var _proto4 = DependantMediaSequenceSync.prototype;

  _proto4.calculateBaseTime_ = function calculateBaseTime_(mediaSequence, fallback) {
    if (!this.storage_.size) {
      var info = this.parent_.getSyncInfoForMediaSequence(mediaSequence);

      if (info) {
        return info.segmentSyncInfo.start;
      }

      return 0;
    }

    return _MediaSequenceSync.prototype.calculateBaseTime_.call(this, mediaSequence, fallback);
  };

  return DependantMediaSequenceSync;
}(MediaSequenceSync);

function _createForOfIteratorHelperLoose$2(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (it) return (it = it.call(o)).next.bind(it); if (Array.isArray(o) || (it = _unsupportedIterableToArray$2(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; return function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray$2(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray$2(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$2(o, minLen); }

function _arrayLikeToArray$2(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
// synchronize expired playlist segments.
// the max media sequence diff is 48 hours of live stream
// content with two second segments. Anything larger than that
// will likely be invalid.

var MAX_MEDIA_SEQUENCE_DIFF_FOR_SYNC = 86400;
var syncPointStrategies = [// Stategy "VOD": Handle the VOD-case where the sync-point is *always*
//                the equivalence display-time 0 === segment-index 0
{
  name: 'VOD',
  run: function run(syncController, playlist, duration, currentTimeline, currentTime) {
    if (duration !== Infinity) {
      var syncPoint = {
        time: 0,
        segmentIndex: 0,
        partIndex: null
      };
      return syncPoint;
    }

    return null;
  }
}, {
  name: 'MediaSequence',

  /**
   * run media sequence strategy
   *
   * @param {SyncController} syncController
   * @param {Object} playlist
   * @param {number} duration
   * @param {number} currentTimeline
   * @param {number} currentTime
   * @param {string} type
   */
  run: function run(syncController, playlist, duration, currentTimeline, currentTime, type) {
    var mediaSequenceSync = syncController.getMediaSequenceSync(type);

    if (!mediaSequenceSync) {
      return null;
    }

    if (!mediaSequenceSync.isReliable) {
      return null;
    }

    var syncInfo = mediaSequenceSync.getSyncInfoForTime(currentTime);

    if (!syncInfo) {
      return null;
    }

    return {
      time: syncInfo.start,
      partIndex: syncInfo.partIndex,
      segmentIndex: syncInfo.segmentIndex
    };
  }
}, // Stategy "ProgramDateTime": We have a program-date-time tag in this playlist
{
  name: 'ProgramDateTime',
  run: function run(syncController, playlist, duration, currentTimeline, currentTime) {
    if (!Object.keys(syncController.timelineToDatetimeMappings).length) {
      return null;
    }

    var syncPoint = null;
    var lastDistance = null;
    var partsAndSegments = getPartsAndSegments(playlist);
    currentTime = currentTime || 0;

    for (var i = 0; i < partsAndSegments.length; i++) {
      // start from the end and loop backwards for live
      // or start from the front and loop forwards for non-live
      var index = playlist.endList || currentTime === 0 ? i : partsAndSegments.length - (i + 1);
      var partAndSegment = partsAndSegments[index];
      var segment = partAndSegment.segment;
      var datetimeMapping = syncController.timelineToDatetimeMappings[segment.timeline];

      if (!datetimeMapping || !segment.dateTimeObject) {
        continue;
      }

      var segmentTime = segment.dateTimeObject.getTime() / 1000;
      var start = segmentTime + datetimeMapping; // take part duration into account.

      if (segment.parts && typeof partAndSegment.partIndex === 'number') {
        for (var z = 0; z < partAndSegment.partIndex; z++) {
          start += segment.parts[z].duration;
        }
      }

      var distance = Math.abs(currentTime - start); // Once the distance begins to increase, or if distance is 0, we have passed
      // currentTime and can stop looking for better candidates

      if (lastDistance !== null && (distance === 0 || lastDistance < distance)) {
        break;
      }

      lastDistance = distance;
      syncPoint = {
        time: start,
        segmentIndex: partAndSegment.segmentIndex,
        partIndex: partAndSegment.partIndex
      };
    }

    return syncPoint;
  }
}, // Stategy "Segment": We have a known time mapping for a timeline and a
//                    segment in the current timeline with timing data
{
  name: 'Segment',
  run: function run(syncController, playlist, duration, currentTimeline, currentTime) {
    var syncPoint = null;
    var lastDistance = null;
    currentTime = currentTime || 0;
    var partsAndSegments = getPartsAndSegments(playlist);

    for (var i = 0; i < partsAndSegments.length; i++) {
      // start from the end and loop backwards for live
      // or start from the front and loop forwards for non-live
      var index = playlist.endList || currentTime === 0 ? i : partsAndSegments.length - (i + 1);
      var partAndSegment = partsAndSegments[index];
      var segment = partAndSegment.segment;
      var start = partAndSegment.part && partAndSegment.part.start || segment && segment.start;

      if (segment.timeline === currentTimeline && typeof start !== 'undefined') {
        var distance = Math.abs(currentTime - start); // Once the distance begins to increase, we have passed
        // currentTime and can stop looking for better candidates

        if (lastDistance !== null && lastDistance < distance) {
          break;
        }

        if (!syncPoint || lastDistance === null || lastDistance >= distance) {
          lastDistance = distance;
          syncPoint = {
            time: start,
            segmentIndex: partAndSegment.segmentIndex,
            partIndex: partAndSegment.partIndex
          };
        }
      }
    }

    return syncPoint;
  }
}, // Stategy "Discontinuity": We have a discontinuity with a known
//                          display-time
{
  name: 'Discontinuity',
  run: function run(syncController, playlist, duration, currentTimeline, currentTime) {
    var syncPoint = null;
    currentTime = currentTime || 0;

    if (playlist.discontinuityStarts && playlist.discontinuityStarts.length) {
      var lastDistance = null;

      for (var i = 0; i < playlist.discontinuityStarts.length; i++) {
        var segmentIndex = playlist.discontinuityStarts[i];
        var discontinuity = playlist.discontinuitySequence + i + 1;
        var discontinuitySync = syncController.discontinuities[discontinuity];

        if (discontinuitySync) {
          var distance = Math.abs(currentTime - discontinuitySync.time); // Once the distance begins to increase, we have passed
          // currentTime and can stop looking for better candidates

          if (lastDistance !== null && lastDistance < distance) {
            break;
          }

          if (!syncPoint || lastDistance === null || lastDistance >= distance) {
            lastDistance = distance;
            syncPoint = {
              time: discontinuitySync.time,
              segmentIndex: segmentIndex,
              partIndex: null
            };
          }
        }
      }
    }

    return syncPoint;
  }
}, // Stategy "Playlist": We have a playlist with a known mapping of
//                     segment index to display time
{
  name: 'Playlist',
  run: function run(syncController, playlist, duration, currentTimeline, currentTime) {
    if (playlist.syncInfo) {
      var syncPoint = {
        time: playlist.syncInfo.time,
        segmentIndex: playlist.syncInfo.mediaSequence - playlist.mediaSequence,
        partIndex: null
      };
      return syncPoint;
    }

    return null;
  }
}];

var SyncController = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(SyncController, _videojs$EventTarget);

  function SyncController(options) {
    var _this;

    _this = _videojs$EventTarget.call(this) || this; // ...for synching across variants

    _this.timelines = [];
    _this.discontinuities = [];
    _this.timelineToDatetimeMappings = {}; // TODO: this map should be only available for HLS. Since only HLS has MediaSequence.
    //  For some reason this map helps with syncing between quality switch for MPEG-DASH as well.
    //  Moreover if we disable this map for MPEG-DASH - quality switch will be broken.
    //  MPEG-DASH should have its own separate sync strategy

    var main = new MediaSequenceSync();
    var audio = new DependantMediaSequenceSync(main);
    var vtt = new DependantMediaSequenceSync(main);
    _this.mediaSequenceStorage_ = {
      main: main,
      audio: audio,
      vtt: vtt
    };
    _this.logger_ = logger('SyncController');
    return _this;
  }
  /**
   *
   * @param {string} loaderType
   * @return {MediaSequenceSync|null}
   */


  var _proto = SyncController.prototype;

  _proto.getMediaSequenceSync = function getMediaSequenceSync(loaderType) {
    return this.mediaSequenceStorage_[loaderType] || null;
  }
  /**
   * Find a sync-point for the playlist specified
   *
   * A sync-point is defined as a known mapping from display-time to
   * a segment-index in the current playlist.
   *
   * @param {Playlist} playlist
   *        The playlist that needs a sync-point
   * @param {number} duration
   *        Duration of the MediaSource (Infinite if playing a live source)
   * @param {number} currentTimeline
   *        The last timeline from which a segment was loaded
   * @param {number} currentTime
   *        Current player's time
   * @param {string} type
   *        Segment loader type
   * @return {Object}
   *          A sync-point object
   */
  ;

  _proto.getSyncPoint = function getSyncPoint(playlist, duration, currentTimeline, currentTime, type) {
    // Always use VOD sync point for VOD
    if (duration !== Infinity) {
      var vodSyncPointStrategy = syncPointStrategies.find(function (_ref) {
        var name = _ref.name;
        return name === 'VOD';
      });
      return vodSyncPointStrategy.run(this, playlist, duration);
    }

    var syncPoints = this.runStrategies_(playlist, duration, currentTimeline, currentTime, type);

    if (!syncPoints.length) {
      // Signal that we need to attempt to get a sync-point manually
      // by fetching a segment in the playlist and constructing
      // a sync-point from that information
      return null;
    } // If we have exact match just return it instead of finding the nearest distance


    for (var _iterator = _createForOfIteratorHelperLoose$2(syncPoints), _step; !(_step = _iterator()).done;) {
      var syncPointInfo = _step.value;
      var syncPoint = syncPointInfo.syncPoint,
          strategy = syncPointInfo.strategy;
      var segmentIndex = syncPoint.segmentIndex,
          time = syncPoint.time;

      if (segmentIndex < 0) {
        continue;
      }

      var selectedSegment = playlist.segments[segmentIndex];
      var start = time;
      var end = start + selectedSegment.duration;
      this.logger_("Strategy: " + strategy + ". Current time: " + currentTime + ". selected segment: " + segmentIndex + ". Time: [" + start + " -> " + end + "]}");

      if (currentTime >= start && currentTime < end) {
        this.logger_('Found sync point with exact match: ', syncPoint);
        return syncPoint;
      }
    } // Now find the sync-point that is closest to the currentTime because
    // that should result in the most accurate guess about which segment
    // to fetch


    return this.selectSyncPoint_(syncPoints, {
      key: 'time',
      value: currentTime
    });
  }
  /**
   * Calculate the amount of time that has expired off the playlist during playback
   *
   * @param {Playlist} playlist
   *        Playlist object to calculate expired from
   * @param {number} duration
   *        Duration of the MediaSource (Infinity if playling a live source)
   * @return {number|null}
   *          The amount of time that has expired off the playlist during playback. Null
   *          if no sync-points for the playlist can be found.
   */
  ;

  _proto.getExpiredTime = function getExpiredTime(playlist, duration) {
    if (!playlist || !playlist.segments) {
      return null;
    }

    var syncPoints = this.runStrategies_(playlist, duration, playlist.discontinuitySequence, 0); // Without sync-points, there is not enough information to determine the expired time

    if (!syncPoints.length) {
      return null;
    }

    var syncPoint = this.selectSyncPoint_(syncPoints, {
      key: 'segmentIndex',
      value: 0
    }); // If the sync-point is beyond the start of the playlist, we want to subtract the
    // duration from index 0 to syncPoint.segmentIndex instead of adding.

    if (syncPoint.segmentIndex > 0) {
      syncPoint.time *= -1;
    }

    return Math.abs(syncPoint.time + sumDurations({
      defaultDuration: playlist.targetDuration,
      durationList: playlist.segments,
      startIndex: syncPoint.segmentIndex,
      endIndex: 0
    }));
  }
  /**
   * Runs each sync-point strategy and returns a list of sync-points returned by the
   * strategies
   *
   * @private
   * @param {Playlist} playlist
   *        The playlist that needs a sync-point
   * @param {number} duration
   *        Duration of the MediaSource (Infinity if playing a live source)
   * @param {number} currentTimeline
   *        The last timeline from which a segment was loaded
   * @param {number} currentTime
   *        Current player's time
   * @param {string} type
   *        Segment loader type
   * @return {Array}
   *          A list of sync-point objects
   */
  ;

  _proto.runStrategies_ = function runStrategies_(playlist, duration, currentTimeline, currentTime, type) {
    var syncPoints = []; // Try to find a sync-point in by utilizing various strategies...

    for (var i = 0; i < syncPointStrategies.length; i++) {
      var strategy = syncPointStrategies[i];
      var syncPoint = strategy.run(this, playlist, duration, currentTimeline, currentTime, type);

      if (syncPoint) {
        syncPoint.strategy = strategy.name;
        syncPoints.push({
          strategy: strategy.name,
          syncPoint: syncPoint
        });
      }
    }

    return syncPoints;
  }
  /**
   * Selects the sync-point nearest the specified target
   *
   * @private
   * @param {Array} syncPoints
   *        List of sync-points to select from
   * @param {Object} target
   *        Object specifying the property and value we are targeting
   * @param {string} target.key
   *        Specifies the property to target. Must be either 'time' or 'segmentIndex'
   * @param {number} target.value
   *        The value to target for the specified key.
   * @return {Object}
   *          The sync-point nearest the target
   */
  ;

  _proto.selectSyncPoint_ = function selectSyncPoint_(syncPoints, target) {
    var bestSyncPoint = syncPoints[0].syncPoint;
    var bestDistance = Math.abs(syncPoints[0].syncPoint[target.key] - target.value);
    var bestStrategy = syncPoints[0].strategy;

    for (var i = 1; i < syncPoints.length; i++) {
      var newDistance = Math.abs(syncPoints[i].syncPoint[target.key] - target.value);

      if (newDistance < bestDistance) {
        bestDistance = newDistance;
        bestSyncPoint = syncPoints[i].syncPoint;
        bestStrategy = syncPoints[i].strategy;
      }
    }

    this.logger_("syncPoint for [" + target.key + ": " + target.value + "] chosen with strategy" + (" [" + bestStrategy + "]: [time:" + bestSyncPoint.time + ",") + (" segmentIndex:" + bestSyncPoint.segmentIndex) + (typeof bestSyncPoint.partIndex === 'number' ? ",partIndex:" + bestSyncPoint.partIndex : '') + ']');
    return bestSyncPoint;
  }
  /**
   * Save any meta-data present on the segments when segments leave
   * the live window to the playlist to allow for synchronization at the
   * playlist level later.
   *
   * @param {Playlist} oldPlaylist - The previous active playlist
   * @param {Playlist} newPlaylist - The updated and most current playlist
   */
  ;

  _proto.saveExpiredSegmentInfo = function saveExpiredSegmentInfo(oldPlaylist, newPlaylist) {
    var mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence; // Ignore large media sequence gaps

    if (mediaSequenceDiff > MAX_MEDIA_SEQUENCE_DIFF_FOR_SYNC) {
      videojs.log.warn("Not saving expired segment info. Media sequence gap " + mediaSequenceDiff + " is too large.");
      return;
    } // When a segment expires from the playlist and it has a start time
    // save that information as a possible sync-point reference in future


    for (var i = mediaSequenceDiff - 1; i >= 0; i--) {
      var lastRemovedSegment = oldPlaylist.segments[i];

      if (lastRemovedSegment && typeof lastRemovedSegment.start !== 'undefined') {
        newPlaylist.syncInfo = {
          mediaSequence: oldPlaylist.mediaSequence + i,
          time: lastRemovedSegment.start
        };
        this.logger_("playlist refresh sync: [time:" + newPlaylist.syncInfo.time + "," + (" mediaSequence: " + newPlaylist.syncInfo.mediaSequence + "]"));
        this.trigger('syncinfoupdate');
        break;
      }
    }
  }
  /**
   * Save the mapping from playlist's ProgramDateTime to display. This should only happen
   * before segments start to load.
   *
   * @param {Playlist} playlist - The currently active playlist
   */
  ;

  _proto.setDateTimeMappingForStart = function setDateTimeMappingForStart(playlist) {
    // It's possible for the playlist to be updated before playback starts, meaning time
    // zero is not yet set. If, during these playlist refreshes, a discontinuity is
    // crossed, then the old time zero mapping (for the prior timeline) would be retained
    // unless the mappings are cleared.
    this.timelineToDatetimeMappings = {};

    if (playlist.segments && playlist.segments.length && playlist.segments[0].dateTimeObject) {
      var firstSegment = playlist.segments[0];
      var playlistTimestamp = firstSegment.dateTimeObject.getTime() / 1000;
      this.timelineToDatetimeMappings[firstSegment.timeline] = -playlistTimestamp;
    }
  }
  /**
   * Calculates and saves timeline mappings, playlist sync info, and segment timing values
   * based on the latest timing information.
   *
   * @param {Object} options
   *        Options object
   * @param {SegmentInfo} options.segmentInfo
   *        The current active request information
   * @param {boolean} options.shouldSaveTimelineMapping
   *        If there's a timeline change, determines if the timeline mapping should be
   *        saved for timeline mapping and program date time mappings.
   */
  ;

  _proto.saveSegmentTimingInfo = function saveSegmentTimingInfo(_ref2) {
    var segmentInfo = _ref2.segmentInfo,
        shouldSaveTimelineMapping = _ref2.shouldSaveTimelineMapping;
    var didCalculateSegmentTimeMapping = this.calculateSegmentTimeMapping_(segmentInfo, segmentInfo.timingInfo, shouldSaveTimelineMapping);
    var segment = segmentInfo.segment;

    if (didCalculateSegmentTimeMapping) {
      this.saveDiscontinuitySyncInfo_(segmentInfo); // If the playlist does not have sync information yet, record that information
      // now with segment timing information

      if (!segmentInfo.playlist.syncInfo) {
        segmentInfo.playlist.syncInfo = {
          mediaSequence: segmentInfo.playlist.mediaSequence + segmentInfo.mediaIndex,
          time: segment.start
        };
      }
    }

    var dateTime = segment.dateTimeObject;

    if (segment.discontinuity && shouldSaveTimelineMapping && dateTime) {
      this.timelineToDatetimeMappings[segment.timeline] = -(dateTime.getTime() / 1000);
    }
  };

  _proto.timestampOffsetForTimeline = function timestampOffsetForTimeline(timeline) {
    if (typeof this.timelines[timeline] === 'undefined') {
      return null;
    }

    return this.timelines[timeline].time;
  };

  _proto.mappingForTimeline = function mappingForTimeline(timeline) {
    if (typeof this.timelines[timeline] === 'undefined') {
      return null;
    }

    return this.timelines[timeline].mapping;
  }
  /**
   * Use the "media time" for a segment to generate a mapping to "display time" and
   * save that display time to the segment.
   *
   * @private
   * @param {SegmentInfo} segmentInfo
   *        The current active request information
   * @param {Object} timingInfo
   *        The start and end time of the current segment in "media time"
   * @param {boolean} shouldSaveTimelineMapping
   *        If there's a timeline change, determines if the timeline mapping should be
   *        saved in timelines.
   * @return {boolean}
   *          Returns false if segment time mapping could not be calculated
   */
  ;

  _proto.calculateSegmentTimeMapping_ = function calculateSegmentTimeMapping_(segmentInfo, timingInfo, shouldSaveTimelineMapping) {
    // TODO: remove side effects
    var segment = segmentInfo.segment;
    var part = segmentInfo.part;
    var mappingObj = this.timelines[segmentInfo.timeline];
    var start;
    var end;

    if (typeof segmentInfo.timestampOffset === 'number') {
      mappingObj = {
        time: segmentInfo.startOfSegment,
        mapping: segmentInfo.startOfSegment - timingInfo.start
      };

      if (shouldSaveTimelineMapping) {
        this.timelines[segmentInfo.timeline] = mappingObj;
        this.trigger('timestampoffset');
        this.logger_("time mapping for timeline " + segmentInfo.timeline + ": " + ("[time: " + mappingObj.time + "] [mapping: " + mappingObj.mapping + "]"));
      }

      start = segmentInfo.startOfSegment;
      end = timingInfo.end + mappingObj.mapping;
    } else if (mappingObj) {
      start = timingInfo.start + mappingObj.mapping;
      end = timingInfo.end + mappingObj.mapping;
    } else {
      return false;
    }

    if (part) {
      part.start = start;
      part.end = end;
    } // If we don't have a segment start yet or the start value we got
    // is less than our current segment.start value, save a new start value.
    // We have to do this because parts will have segment timing info saved
    // multiple times and we want segment start to be the earliest part start
    // value for that segment.


    if (!segment.start || start < segment.start) {
      segment.start = start;
    }

    segment.end = end;
    return true;
  }
  /**
   * Each time we have discontinuity in the playlist, attempt to calculate the location
   * in display of the start of the discontinuity and save that. We also save an accuracy
   * value so that we save values with the most accuracy (closest to 0.)
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   */
  ;

  _proto.saveDiscontinuitySyncInfo_ = function saveDiscontinuitySyncInfo_(segmentInfo) {
    var playlist = segmentInfo.playlist;
    var segment = segmentInfo.segment; // If the current segment is a discontinuity then we know exactly where
    // the start of the range and it's accuracy is 0 (greater accuracy values
    // mean more approximation)

    if (segment.discontinuity) {
      this.discontinuities[segment.timeline] = {
        time: segment.start,
        accuracy: 0
      };
    } else if (playlist.discontinuityStarts && playlist.discontinuityStarts.length) {
      // Search for future discontinuities that we can provide better timing
      // information for and save that information for sync purposes
      for (var i = 0; i < playlist.discontinuityStarts.length; i++) {
        var segmentIndex = playlist.discontinuityStarts[i];
        var discontinuity = playlist.discontinuitySequence + i + 1;
        var mediaIndexDiff = segmentIndex - segmentInfo.mediaIndex;
        var accuracy = Math.abs(mediaIndexDiff);

        if (!this.discontinuities[discontinuity] || this.discontinuities[discontinuity].accuracy > accuracy) {
          var time = void 0;

          if (mediaIndexDiff < 0) {
            time = segment.start - sumDurations({
              defaultDuration: playlist.targetDuration,
              durationList: playlist.segments,
              startIndex: segmentInfo.mediaIndex,
              endIndex: segmentIndex
            });
          } else {
            time = segment.end + sumDurations({
              defaultDuration: playlist.targetDuration,
              durationList: playlist.segments,
              startIndex: segmentInfo.mediaIndex + 1,
              endIndex: segmentIndex
            });
          }

          this.discontinuities[discontinuity] = {
            time: time,
            accuracy: accuracy
          };
        }
      }
    }
  };

  _proto.dispose = function dispose() {
    this.trigger('dispose');
    this.off();
  };

  return SyncController;
}(videojs.EventTarget);

/**
 * The TimelineChangeController acts as a source for segment loaders to listen for and
 * keep track of latest and pending timeline changes. This is useful to ensure proper
 * sync, as each loader may need to make a consideration for what timeline the other
 * loader is on before making changes which could impact the other loader's media.
 *
 * @class TimelineChangeController
 * @extends videojs.EventTarget
 */

var TimelineChangeController = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(TimelineChangeController, _videojs$EventTarget);

  function TimelineChangeController() {
    var _this;

    _this = _videojs$EventTarget.call(this) || this;
    _this.pendingTimelineChanges_ = {};
    _this.lastTimelineChanges_ = {};
    return _this;
  }

  var _proto = TimelineChangeController.prototype;

  _proto.clearPendingTimelineChange = function clearPendingTimelineChange(type) {
    this.pendingTimelineChanges_[type] = null;
    this.trigger('pendingtimelinechange');
  };

  _proto.pendingTimelineChange = function pendingTimelineChange(_ref) {
    var type = _ref.type,
        from = _ref.from,
        to = _ref.to;

    if (typeof from === 'number' && typeof to === 'number') {
      this.pendingTimelineChanges_[type] = {
        type: type,
        from: from,
        to: to
      };
      this.trigger('pendingtimelinechange');
    }

    return this.pendingTimelineChanges_[type];
  };

  _proto.lastTimelineChange = function lastTimelineChange(_ref2) {
    var type = _ref2.type,
        from = _ref2.from,
        to = _ref2.to;

    if (typeof from === 'number' && typeof to === 'number') {
      this.lastTimelineChanges_[type] = {
        type: type,
        from: from,
        to: to
      };
      delete this.pendingTimelineChanges_[type];
      this.trigger('timelinechange');
    }

    return this.lastTimelineChanges_[type];
  };

  _proto.dispose = function dispose() {
    this.trigger('dispose');
    this.pendingTimelineChanges_ = {};
    this.lastTimelineChanges_ = {};
    this.off();
  };

  return TimelineChangeController;
}(videojs.EventTarget);

/* rollup-plugin-worker-factory start for worker!C:\Users\pjaspinski\Desktop\tellyo\http-streaming\src\decrypter-worker.js */
var workerCode = transform(getWorkerString(function () {

  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function createCommonjsModule(fn, basedir, module) {
    return module = {
      path: basedir,
      exports: {},
      require: function require(path, base) {
        return commonjsRequire(path, base === undefined || base === null ? module.path : base);
      }
    }, fn(module, module.exports), module.exports;
  }

  function commonjsRequire() {
    throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
  }

  var createClass = createCommonjsModule(function (module) {
    function _defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    function _createClass(Constructor, protoProps, staticProps) {
      if (protoProps) _defineProperties(Constructor.prototype, protoProps);
      if (staticProps) _defineProperties(Constructor, staticProps);
      return Constructor;
    }

    module.exports = _createClass;
    module.exports["default"] = module.exports, module.exports.__esModule = true;
  });
  var setPrototypeOf = createCommonjsModule(function (module) {
    function _setPrototypeOf(o, p) {
      module.exports = _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
        o.__proto__ = p;
        return o;
      };

      module.exports["default"] = module.exports, module.exports.__esModule = true;
      return _setPrototypeOf(o, p);
    }

    module.exports = _setPrototypeOf;
    module.exports["default"] = module.exports, module.exports.__esModule = true;
  });
  var inheritsLoose = createCommonjsModule(function (module) {
    function _inheritsLoose(subClass, superClass) {
      subClass.prototype = Object.create(superClass.prototype);
      subClass.prototype.constructor = subClass;
      setPrototypeOf(subClass, superClass);
    }

    module.exports = _inheritsLoose;
    module.exports["default"] = module.exports, module.exports.__esModule = true;
  });
  /**
   * @file stream.js
   */

  /**
   * A lightweight readable stream implemention that handles event dispatching.
   *
   * @class Stream
   */

  var Stream = /*#__PURE__*/function () {
    function Stream() {
      this.listeners = {};
    }
    /**
     * Add a listener for a specified event type.
     *
     * @param {string} type the event name
     * @param {Function} listener the callback to be invoked when an event of
     * the specified type occurs
     */


    var _proto = Stream.prototype;

    _proto.on = function on(type, listener) {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }

      this.listeners[type].push(listener);
    }
    /**
     * Remove a listener for a specified event type.
     *
     * @param {string} type the event name
     * @param {Function} listener  a function previously registered for this
     * type of event through `on`
     * @return {boolean} if we could turn it off or not
     */
    ;

    _proto.off = function off(type, listener) {
      if (!this.listeners[type]) {
        return false;
      }

      var index = this.listeners[type].indexOf(listener); // TODO: which is better?
      // In Video.js we slice listener functions
      // on trigger so that it does not mess up the order
      // while we loop through.
      //
      // Here we slice on off so that the loop in trigger
      // can continue using it's old reference to loop without
      // messing up the order.

      this.listeners[type] = this.listeners[type].slice(0);
      this.listeners[type].splice(index, 1);
      return index > -1;
    }
    /**
     * Trigger an event of the specified type on this stream. Any additional
     * arguments to this function are passed as parameters to event listeners.
     *
     * @param {string} type the event name
     */
    ;

    _proto.trigger = function trigger(type) {
      var callbacks = this.listeners[type];

      if (!callbacks) {
        return;
      } // Slicing the arguments on every invocation of this method
      // can add a significant amount of overhead. Avoid the
      // intermediate object creation for the common case of a
      // single callback argument


      if (arguments.length === 2) {
        var length = callbacks.length;

        for (var i = 0; i < length; ++i) {
          callbacks[i].call(this, arguments[1]);
        }
      } else {
        var args = Array.prototype.slice.call(arguments, 1);
        var _length = callbacks.length;

        for (var _i = 0; _i < _length; ++_i) {
          callbacks[_i].apply(this, args);
        }
      }
    }
    /**
     * Destroys the stream and cleans up.
     */
    ;

    _proto.dispose = function dispose() {
      this.listeners = {};
    }
    /**
     * Forwards all `data` events on this stream to the destination stream. The
     * destination stream should provide a method `push` to receive the data
     * events as they arrive.
     *
     * @param {Stream} destination the stream that will receive all `data` events
     * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
     */
    ;

    _proto.pipe = function pipe(destination) {
      this.on('data', function (data) {
        destination.push(data);
      });
    };

    return Stream;
  }();
  /*! @name pkcs7 @version 1.0.4 @license Apache-2.0 */

  /**
   * Returns the subarray of a Uint8Array without PKCS#7 padding.
   *
   * @param padded {Uint8Array} unencrypted bytes that have been padded
   * @return {Uint8Array} the unpadded bytes
   * @see http://tools.ietf.org/html/rfc5652
   */


  function unpad(padded) {
    return padded.subarray(0, padded.byteLength - padded[padded.byteLength - 1]);
  }
  /*! @name aes-decrypter @version 3.1.3 @license Apache-2.0 */

  /**
   * @file aes.js
   *
   * This file contains an adaptation of the AES decryption algorithm
   * from the Standford Javascript Cryptography Library. That work is
   * covered by the following copyright and permissions notice:
   *
   * Copyright 2009-2010 Emily Stark, Mike Hamburg, Dan Boneh.
   * All rights reserved.
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are
   * met:
   *
   * 1. Redistributions of source code must retain the above copyright
   *    notice, this list of conditions and the following disclaimer.
   *
   * 2. Redistributions in binary form must reproduce the above
   *    copyright notice, this list of conditions and the following
   *    disclaimer in the documentation and/or other materials provided
   *    with the distribution.
   *
   * THIS SOFTWARE IS PROVIDED BY THE AUTHORS ``AS IS'' AND ANY EXPRESS OR
   * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> OR CONTRIBUTORS BE
   * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
   * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
   * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
   * BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
   * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
   * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
   * IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *
   * The views and conclusions contained in the software and documentation
   * are those of the authors and should not be interpreted as representing
   * official policies, either expressed or implied, of the authors.
   */

  /**
   * Expand the S-box tables.
   *
   * @private
   */


  var precompute = function precompute() {
    var tables = [[[], [], [], [], []], [[], [], [], [], []]];
    var encTable = tables[0];
    var decTable = tables[1];
    var sbox = encTable[4];
    var sboxInv = decTable[4];
    var i;
    var x;
    var xInv;
    var d = [];
    var th = [];
    var x2;
    var x4;
    var x8;
    var s;
    var tEnc;
    var tDec; // Compute double and third tables

    for (i = 0; i < 256; i++) {
      th[(d[i] = i << 1 ^ (i >> 7) * 283) ^ i] = i;
    }

    for (x = xInv = 0; !sbox[x]; x ^= x2 || 1, xInv = th[xInv] || 1) {
      // Compute sbox
      s = xInv ^ xInv << 1 ^ xInv << 2 ^ xInv << 3 ^ xInv << 4;
      s = s >> 8 ^ s & 255 ^ 99;
      sbox[x] = s;
      sboxInv[s] = x; // Compute MixColumns

      x8 = d[x4 = d[x2 = d[x]]];
      tDec = x8 * 0x1010101 ^ x4 * 0x10001 ^ x2 * 0x101 ^ x * 0x1010100;
      tEnc = d[s] * 0x101 ^ s * 0x1010100;

      for (i = 0; i < 4; i++) {
        encTable[i][x] = tEnc = tEnc << 24 ^ tEnc >>> 8;
        decTable[i][s] = tDec = tDec << 24 ^ tDec >>> 8;
      }
    } // Compactify. Considerable speedup on Firefox.


    for (i = 0; i < 5; i++) {
      encTable[i] = encTable[i].slice(0);
      decTable[i] = decTable[i].slice(0);
    }

    return tables;
  };

  var aesTables = null;
  /**
   * Schedule out an AES key for both encryption and decryption. This
   * is a low-level class. Use a cipher mode to do bulk encryption.
   *
   * @class AES
   * @param key {Array} The key as an array of 4, 6 or 8 words.
   */

  var AES = /*#__PURE__*/function () {
    function AES(key) {
      /**
      * The expanded S-box and inverse S-box tables. These will be computed
      * on the client so that we don't have to send them down the wire.
      *
      * There are two tables, _tables[0] is for encryption and
      * _tables[1] is for decryption.
      *
      * The first 4 sub-tables are the expanded S-box with MixColumns. The
      * last (_tables[01][4]) is the S-box itself.
      *
      * @private
      */
      // if we have yet to precompute the S-box tables
      // do so now
      if (!aesTables) {
        aesTables = precompute();
      } // then make a copy of that object for use


      this._tables = [[aesTables[0][0].slice(), aesTables[0][1].slice(), aesTables[0][2].slice(), aesTables[0][3].slice(), aesTables[0][4].slice()], [aesTables[1][0].slice(), aesTables[1][1].slice(), aesTables[1][2].slice(), aesTables[1][3].slice(), aesTables[1][4].slice()]];
      var i;
      var j;
      var tmp;
      var sbox = this._tables[0][4];
      var decTable = this._tables[1];
      var keyLen = key.length;
      var rcon = 1;

      if (keyLen !== 4 && keyLen !== 6 && keyLen !== 8) {
        throw new Error('Invalid aes key size');
      }

      var encKey = key.slice(0);
      var decKey = [];
      this._key = [encKey, decKey]; // schedule encryption keys

      for (i = keyLen; i < 4 * keyLen + 28; i++) {
        tmp = encKey[i - 1]; // apply sbox

        if (i % keyLen === 0 || keyLen === 8 && i % keyLen === 4) {
          tmp = sbox[tmp >>> 24] << 24 ^ sbox[tmp >> 16 & 255] << 16 ^ sbox[tmp >> 8 & 255] << 8 ^ sbox[tmp & 255]; // shift rows and add rcon

          if (i % keyLen === 0) {
            tmp = tmp << 8 ^ tmp >>> 24 ^ rcon << 24;
            rcon = rcon << 1 ^ (rcon >> 7) * 283;
          }
        }

        encKey[i] = encKey[i - keyLen] ^ tmp;
      } // schedule decryption keys


      for (j = 0; i; j++, i--) {
        tmp = encKey[j & 3 ? i : i - 4];

        if (i <= 4 || j < 4) {
          decKey[j] = tmp;
        } else {
          decKey[j] = decTable[0][sbox[tmp >>> 24]] ^ decTable[1][sbox[tmp >> 16 & 255]] ^ decTable[2][sbox[tmp >> 8 & 255]] ^ decTable[3][sbox[tmp & 255]];
        }
      }
    }
    /**
     * Decrypt 16 bytes, specified as four 32-bit words.
     *
     * @param {number} encrypted0 the first word to decrypt
     * @param {number} encrypted1 the second word to decrypt
     * @param {number} encrypted2 the third word to decrypt
     * @param {number} encrypted3 the fourth word to decrypt
     * @param {Int32Array} out the array to write the decrypted words
     * into
     * @param {number} offset the offset into the output array to start
     * writing results
     * @return {Array} The plaintext.
     */


    var _proto = AES.prototype;

    _proto.decrypt = function decrypt(encrypted0, encrypted1, encrypted2, encrypted3, out, offset) {
      var key = this._key[1]; // state variables a,b,c,d are loaded with pre-whitened data

      var a = encrypted0 ^ key[0];
      var b = encrypted3 ^ key[1];
      var c = encrypted2 ^ key[2];
      var d = encrypted1 ^ key[3];
      var a2;
      var b2;
      var c2; // key.length === 2 ?

      var nInnerRounds = key.length / 4 - 2;
      var i;
      var kIndex = 4;
      var table = this._tables[1]; // load up the tables

      var table0 = table[0];
      var table1 = table[1];
      var table2 = table[2];
      var table3 = table[3];
      var sbox = table[4]; // Inner rounds. Cribbed from OpenSSL.

      for (i = 0; i < nInnerRounds; i++) {
        a2 = table0[a >>> 24] ^ table1[b >> 16 & 255] ^ table2[c >> 8 & 255] ^ table3[d & 255] ^ key[kIndex];
        b2 = table0[b >>> 24] ^ table1[c >> 16 & 255] ^ table2[d >> 8 & 255] ^ table3[a & 255] ^ key[kIndex + 1];
        c2 = table0[c >>> 24] ^ table1[d >> 16 & 255] ^ table2[a >> 8 & 255] ^ table3[b & 255] ^ key[kIndex + 2];
        d = table0[d >>> 24] ^ table1[a >> 16 & 255] ^ table2[b >> 8 & 255] ^ table3[c & 255] ^ key[kIndex + 3];
        kIndex += 4;
        a = a2;
        b = b2;
        c = c2;
      } // Last round.


      for (i = 0; i < 4; i++) {
        out[(3 & -i) + offset] = sbox[a >>> 24] << 24 ^ sbox[b >> 16 & 255] << 16 ^ sbox[c >> 8 & 255] << 8 ^ sbox[d & 255] ^ key[kIndex++];
        a2 = a;
        a = b;
        b = c;
        c = d;
        d = a2;
      }
    };

    return AES;
  }();
  /**
   * A wrapper around the Stream class to use setTimeout
   * and run stream "jobs" Asynchronously
   *
   * @class AsyncStream
   * @extends Stream
   */


  var AsyncStream = /*#__PURE__*/function (_Stream) {
    inheritsLoose(AsyncStream, _Stream);

    function AsyncStream() {
      var _this;

      _this = _Stream.call(this, Stream) || this;
      _this.jobs = [];
      _this.delay = 1;
      _this.timeout_ = null;
      return _this;
    }
    /**
     * process an async job
     *
     * @private
     */


    var _proto = AsyncStream.prototype;

    _proto.processJob_ = function processJob_() {
      this.jobs.shift()();

      if (this.jobs.length) {
        this.timeout_ = setTimeout(this.processJob_.bind(this), this.delay);
      } else {
        this.timeout_ = null;
      }
    }
    /**
     * push a job into the stream
     *
     * @param {Function} job the job to push into the stream
     */
    ;

    _proto.push = function push(job) {
      this.jobs.push(job);

      if (!this.timeout_) {
        this.timeout_ = setTimeout(this.processJob_.bind(this), this.delay);
      }
    };

    return AsyncStream;
  }(Stream);
  /**
   * Convert network-order (big-endian) bytes into their little-endian
   * representation.
   */


  var ntoh = function ntoh(word) {
    return word << 24 | (word & 0xff00) << 8 | (word & 0xff0000) >> 8 | word >>> 24;
  };
  /**
   * Decrypt bytes using AES-128 with CBC and PKCS#7 padding.
   *
   * @param {Uint8Array} encrypted the encrypted bytes
   * @param {Uint32Array} key the bytes of the decryption key
   * @param {Uint32Array} initVector the initialization vector (IV) to
   * use for the first round of CBC.
   * @return {Uint8Array} the decrypted bytes
   *
   * @see http://en.wikipedia.org/wiki/Advanced_Encryption_Standard
   * @see http://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#Cipher_Block_Chaining_.28CBC.29
   * @see https://tools.ietf.org/html/rfc2315
   */


  var decrypt = function decrypt(encrypted, key, initVector) {
    // word-level access to the encrypted bytes
    var encrypted32 = new Int32Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength >> 2);
    var decipher = new AES(Array.prototype.slice.call(key)); // byte and word-level access for the decrypted output

    var decrypted = new Uint8Array(encrypted.byteLength);
    var decrypted32 = new Int32Array(decrypted.buffer); // temporary variables for working with the IV, encrypted, and
    // decrypted data

    var init0;
    var init1;
    var init2;
    var init3;
    var encrypted0;
    var encrypted1;
    var encrypted2;
    var encrypted3; // iteration variable

    var wordIx; // pull out the words of the IV to ensure we don't modify the
    // passed-in reference and easier access

    init0 = initVector[0];
    init1 = initVector[1];
    init2 = initVector[2];
    init3 = initVector[3]; // decrypt four word sequences, applying cipher-block chaining (CBC)
    // to each decrypted block

    for (wordIx = 0; wordIx < encrypted32.length; wordIx += 4) {
      // convert big-endian (network order) words into little-endian
      // (javascript order)
      encrypted0 = ntoh(encrypted32[wordIx]);
      encrypted1 = ntoh(encrypted32[wordIx + 1]);
      encrypted2 = ntoh(encrypted32[wordIx + 2]);
      encrypted3 = ntoh(encrypted32[wordIx + 3]); // decrypt the block

      decipher.decrypt(encrypted0, encrypted1, encrypted2, encrypted3, decrypted32, wordIx); // XOR with the IV, and restore network byte-order to obtain the
      // plaintext

      decrypted32[wordIx] = ntoh(decrypted32[wordIx] ^ init0);
      decrypted32[wordIx + 1] = ntoh(decrypted32[wordIx + 1] ^ init1);
      decrypted32[wordIx + 2] = ntoh(decrypted32[wordIx + 2] ^ init2);
      decrypted32[wordIx + 3] = ntoh(decrypted32[wordIx + 3] ^ init3); // setup the IV for the next round

      init0 = encrypted0;
      init1 = encrypted1;
      init2 = encrypted2;
      init3 = encrypted3;
    }

    return decrypted;
  };
  /**
   * The `Decrypter` class that manages decryption of AES
   * data through `AsyncStream` objects and the `decrypt`
   * function
   *
   * @param {Uint8Array} encrypted the encrypted bytes
   * @param {Uint32Array} key the bytes of the decryption key
   * @param {Uint32Array} initVector the initialization vector (IV) to
   * @param {Function} done the function to run when done
   * @class Decrypter
   */


  var Decrypter = /*#__PURE__*/function () {
    function Decrypter(encrypted, key, initVector, done) {
      var step = Decrypter.STEP;
      var encrypted32 = new Int32Array(encrypted.buffer);
      var decrypted = new Uint8Array(encrypted.byteLength);
      var i = 0;
      this.asyncStream_ = new AsyncStream(); // split up the encryption job and do the individual chunks asynchronously

      this.asyncStream_.push(this.decryptChunk_(encrypted32.subarray(i, i + step), key, initVector, decrypted));

      for (i = step; i < encrypted32.length; i += step) {
        initVector = new Uint32Array([ntoh(encrypted32[i - 4]), ntoh(encrypted32[i - 3]), ntoh(encrypted32[i - 2]), ntoh(encrypted32[i - 1])]);
        this.asyncStream_.push(this.decryptChunk_(encrypted32.subarray(i, i + step), key, initVector, decrypted));
      } // invoke the done() callback when everything is finished


      this.asyncStream_.push(function () {
        // remove pkcs#7 padding from the decrypted bytes
        done(null, unpad(decrypted));
      });
    }
    /**
     * a getter for step the maximum number of bytes to process at one time
     *
     * @return {number} the value of step 32000
     */


    var _proto = Decrypter.prototype;
    /**
     * @private
     */

    _proto.decryptChunk_ = function decryptChunk_(encrypted, key, initVector, decrypted) {
      return function () {
        var bytes = decrypt(encrypted, key, initVector);
        decrypted.set(bytes, encrypted.byteOffset);
      };
    };

    createClass(Decrypter, null, [{
      key: "STEP",
      get: function get() {
        // 4 * 8000;
        return 32000;
      }
    }]);
    return Decrypter;
  }();

  var win;

  if (typeof window !== "undefined") {
    win = window;
  } else if (typeof commonjsGlobal !== "undefined") {
    win = commonjsGlobal;
  } else if (typeof self !== "undefined") {
    win = self;
  } else {
    win = {};
  }

  var window_1 = win;

  var isArrayBufferView = function isArrayBufferView(obj) {
    if (ArrayBuffer.isView === 'function') {
      return ArrayBuffer.isView(obj);
    }

    return obj && obj.buffer instanceof ArrayBuffer;
  };

  var BigInt = window_1.BigInt || Number;
  [BigInt('0x1'), BigInt('0x100'), BigInt('0x10000'), BigInt('0x1000000'), BigInt('0x100000000'), BigInt('0x10000000000'), BigInt('0x1000000000000'), BigInt('0x100000000000000'), BigInt('0x10000000000000000')];

  (function () {
    var a = new Uint16Array([0xFFCC]);
    var b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

    if (b[0] === 0xFF) {
      return 'big';
    }

    if (b[0] === 0xCC) {
      return 'little';
    }

    return 'unknown';
  })();
  /**
   * Creates an object for sending to a web worker modifying properties that are TypedArrays
   * into a new object with seperated properties for the buffer, byteOffset, and byteLength.
   *
   * @param {Object} message
   *        Object of properties and values to send to the web worker
   * @return {Object}
   *         Modified message with TypedArray values expanded
   * @function createTransferableMessage
   */


  var createTransferableMessage = function createTransferableMessage(message) {
    var transferable = {};
    Object.keys(message).forEach(function (key) {
      var value = message[key];

      if (isArrayBufferView(value)) {
        transferable[key] = {
          bytes: value.buffer,
          byteOffset: value.byteOffset,
          byteLength: value.byteLength
        };
      } else {
        transferable[key] = value;
      }
    });
    return transferable;
  };
  /* global self */

  /**
   * Our web worker interface so that things can talk to aes-decrypter
   * that will be running in a web worker. the scope is passed to this by
   * webworkify.
   */


  self.onmessage = function (event) {
    var data = event.data;
    var encrypted = new Uint8Array(data.encrypted.bytes, data.encrypted.byteOffset, data.encrypted.byteLength);
    var key = new Uint32Array(data.key.bytes, data.key.byteOffset, data.key.byteLength / 4);
    var iv = new Uint32Array(data.iv.bytes, data.iv.byteOffset, data.iv.byteLength / 4);
    /* eslint-disable no-new, handle-callback-err */

    new Decrypter(encrypted, key, iv, function (err, bytes) {
      self.postMessage(createTransferableMessage({
        source: data.source,
        decrypted: bytes
      }), [bytes.buffer]);
    });
    /* eslint-enable */
  };
}));
var Decrypter = factory(workerCode);
/* rollup-plugin-worker-factory end for worker!C:\Users\pjaspinski\Desktop\tellyo\http-streaming\src\decrypter-worker.js */

/**
 * Convert the properties of an HLS track into an audioTrackKind.
 *
 * @private
 */

var audioTrackKind_ = function audioTrackKind_(properties) {
  var kind = properties.default ? 'main' : 'alternative';

  if (properties.characteristics && properties.characteristics.indexOf('public.accessibility.describes-video') >= 0) {
    kind = 'main-desc';
  }

  return kind;
};
/**
 * Pause provided segment loader and playlist loader if active
 *
 * @param {SegmentLoader} segmentLoader
 *        SegmentLoader to pause
 * @param {Object} mediaType
 *        Active media type
 * @function stopLoaders
 */


var stopLoaders = function stopLoaders(segmentLoader, mediaType) {
  segmentLoader.abort();
  segmentLoader.pause();

  if (mediaType && mediaType.activePlaylistLoader) {
    mediaType.activePlaylistLoader.pause();
    mediaType.activePlaylistLoader = null;
  }
};
/**
 * Start loading provided segment loader and playlist loader
 *
 * @param {PlaylistLoader} playlistLoader
 *        PlaylistLoader to start loading
 * @param {Object} mediaType
 *        Active media type
 * @function startLoaders
 */

var startLoaders = function startLoaders(playlistLoader, mediaType) {
  // Segment loader will be started after `loadedmetadata` or `loadedplaylist` from the
  // playlist loader
  mediaType.activePlaylistLoader = playlistLoader;
  playlistLoader.load();
};
/**
 * Returns a function to be called when the media group changes. It performs a
 * non-destructive (preserve the buffer) resync of the SegmentLoader. This is because a
 * change of group is merely a rendition switch of the same content at another encoding,
 * rather than a change of content, such as switching audio from English to Spanish.
 *
 * @param {string} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Handler for a non-destructive resync of SegmentLoader when the active media
 *         group changes.
 * @function onGroupChanged
 */

var onGroupChanged = function onGroupChanged(type, settings) {
  return function () {
    var _settings$segmentLoad = settings.segmentLoaders,
        segmentLoader = _settings$segmentLoad[type],
        mainSegmentLoader = _settings$segmentLoad.main,
        mediaType = settings.mediaTypes[type];
    var activeTrack = mediaType.activeTrack();
    var activeGroup = mediaType.getActiveGroup();
    var previousActiveLoader = mediaType.activePlaylistLoader;
    var lastGroup = mediaType.lastGroup_; // the group did not change do nothing

    if (activeGroup && lastGroup && activeGroup.id === lastGroup.id) {
      return;
    }

    mediaType.lastGroup_ = activeGroup;
    mediaType.lastTrack_ = activeTrack;
    stopLoaders(segmentLoader, mediaType);

    if (!activeGroup || activeGroup.isMainPlaylist) {
      // there is no group active or active group is a main playlist and won't change
      return;
    }

    if (!activeGroup.playlistLoader) {
      if (previousActiveLoader) {
        // The previous group had a playlist loader but the new active group does not
        // this means we are switching from demuxed to muxed audio. In this case we want to
        // do a destructive reset of the main segment loader and not restart the audio
        // loaders.
        mainSegmentLoader.resetEverything();
      }

      return;
    } // Non-destructive resync


    segmentLoader.resyncLoader();
    startLoaders(activeGroup.playlistLoader, mediaType);
  };
};
var onGroupChanging = function onGroupChanging(type, settings) {
  return function () {
    var segmentLoader = settings.segmentLoaders[type],
        mediaType = settings.mediaTypes[type];
    mediaType.lastGroup_ = null;
    segmentLoader.abort();
    segmentLoader.pause();
  };
};
/**
 * Returns a function to be called when the media track changes. It performs a
 * destructive reset of the SegmentLoader to ensure we start loading as close to
 * currentTime as possible.
 *
 * @param {string} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Handler for a destructive reset of SegmentLoader when the active media
 *         track changes.
 * @function onTrackChanged
 */

var onTrackChanged = function onTrackChanged(type, settings) {
  return function () {
    var mainPlaylistLoader = settings.mainPlaylistLoader,
        _settings$segmentLoad2 = settings.segmentLoaders,
        segmentLoader = _settings$segmentLoad2[type],
        mainSegmentLoader = _settings$segmentLoad2.main,
        mediaType = settings.mediaTypes[type];
    var activeTrack = mediaType.activeTrack();
    var activeGroup = mediaType.getActiveGroup();
    var previousActiveLoader = mediaType.activePlaylistLoader;
    var lastTrack = mediaType.lastTrack_; // track did not change, do nothing

    if (lastTrack && activeTrack && lastTrack.id === activeTrack.id) {
      return;
    }

    mediaType.lastGroup_ = activeGroup;
    mediaType.lastTrack_ = activeTrack;
    stopLoaders(segmentLoader, mediaType);

    if (!activeGroup) {
      // there is no group active so we do not want to restart loaders
      return;
    }

    if (activeGroup.isMainPlaylist) {
      // track did not change, do nothing
      if (!activeTrack || !lastTrack || activeTrack.id === lastTrack.id) {
        return;
      }

      var pc = settings.vhs.playlistController_;
      var newPlaylist = pc.selectPlaylist(); // media will not change do nothing

      if (pc.media() === newPlaylist) {
        return;
      }

      mediaType.logger_("track change. Switching main audio from " + lastTrack.id + " to " + activeTrack.id);
      mainPlaylistLoader.pause();
      mainSegmentLoader.resetEverything();
      pc.fastQualityChange_(newPlaylist);
      return;
    }

    if (type === 'AUDIO') {
      if (!activeGroup.playlistLoader) {
        // when switching from demuxed audio/video to muxed audio/video (noted by no
        // playlist loader for the audio group), we want to do a destructive reset of the
        // main segment loader and not restart the audio loaders
        mainSegmentLoader.setAudio(true); // don't have to worry about disabling the audio of the audio segment loader since
        // it should be stopped

        mainSegmentLoader.resetEverything();
        return;
      } // although the segment loader is an audio segment loader, call the setAudio
      // function to ensure it is prepared to re-append the init segment (or handle other
      // config changes)


      segmentLoader.setAudio(true);
      mainSegmentLoader.setAudio(false);
    }

    if (previousActiveLoader === activeGroup.playlistLoader) {
      // Nothing has actually changed. This can happen because track change events can fire
      // multiple times for a "single" change. One for enabling the new active track, and
      // one for disabling the track that was active
      startLoaders(activeGroup.playlistLoader, mediaType);
      return;
    }

    if (segmentLoader.track) {
      // For WebVTT, set the new text track in the segmentloader
      segmentLoader.track(activeTrack);
    } // destructive reset


    segmentLoader.resetEverything();
    startLoaders(activeGroup.playlistLoader, mediaType);
  };
};
var onError = {
  /**
   * Returns a function to be called when a SegmentLoader or PlaylistLoader encounters
   * an error.
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Error handler. Logs warning (or error if the playlist is excluded) to
   *         console and switches back to default audio track.
   * @function onError.AUDIO
   */
  AUDIO: function AUDIO(type, settings) {
    return function () {
      var mediaType = settings.mediaTypes[type],
          excludePlaylist = settings.excludePlaylist; // switch back to default audio track

      var activeTrack = mediaType.activeTrack();
      var activeGroup = mediaType.activeGroup();
      var id = (activeGroup.filter(function (group) {
        return group.default;
      })[0] || activeGroup[0]).id;
      var defaultTrack = mediaType.tracks[id];

      if (activeTrack === defaultTrack) {
        // Default track encountered an error. All we can do now is exclude the current
        // rendition and hope another will switch audio groups
        excludePlaylist({
          error: {
            message: 'Problem encountered loading the default audio track.'
          }
        });
        return;
      }

      videojs.log.warn('Problem encountered loading the alternate audio track.' + 'Switching back to default.');

      for (var trackId in mediaType.tracks) {
        mediaType.tracks[trackId].enabled = mediaType.tracks[trackId] === defaultTrack;
      }

      mediaType.onTrackChanged();
    };
  },

  /**
   * Returns a function to be called when a SegmentLoader or PlaylistLoader encounters
   * an error.
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Error handler. Logs warning to console and disables the active subtitle track
   * @function onError.SUBTITLES
   */
  SUBTITLES: function SUBTITLES(type, settings) {
    return function () {
      var mediaType = settings.mediaTypes[type];
      videojs.log.warn('Problem encountered loading the subtitle track.' + 'Disabling subtitle track.');
      var track = mediaType.activeTrack();

      if (track) {
        track.mode = 'disabled';
      }

      mediaType.onTrackChanged();
    };
  }
};
var setupListeners = {
  /**
   * Setup event listeners for audio playlist loader
   *
   * @param {string} type
   *        MediaGroup type
   * @param {PlaylistLoader|null} playlistLoader
   *        PlaylistLoader to register listeners on
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function setupListeners.AUDIO
   */
  AUDIO: function AUDIO(type, playlistLoader, settings) {
    if (!playlistLoader) {
      // no playlist loader means audio will be muxed with the video
      return;
    }

    var tech = settings.tech,
        requestOptions = settings.requestOptions,
        segmentLoader = settings.segmentLoaders[type];
    playlistLoader.on('loadedmetadata', function () {
      var media = playlistLoader.media();
      segmentLoader.playlist(media, requestOptions); // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments

      if (!tech.paused() || media.endList && tech.preload() !== 'none') {
        segmentLoader.load();
      }
    });
    playlistLoader.on('loadedplaylist', function () {
      segmentLoader.playlist(playlistLoader.media(), requestOptions); // If the player isn't paused, ensure that the segment loader is running

      if (!tech.paused()) {
        segmentLoader.load();
      }
    });
    playlistLoader.on('error', onError[type](type, settings));
  },

  /**
   * Setup event listeners for subtitle playlist loader
   *
   * @param {string} type
   *        MediaGroup type
   * @param {PlaylistLoader|null} playlistLoader
   *        PlaylistLoader to register listeners on
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function setupListeners.SUBTITLES
   */
  SUBTITLES: function SUBTITLES(type, playlistLoader, settings) {
    var tech = settings.tech,
        requestOptions = settings.requestOptions,
        segmentLoader = settings.segmentLoaders[type],
        mediaType = settings.mediaTypes[type];
    playlistLoader.on('loadedmetadata', function () {
      var media = playlistLoader.media();
      segmentLoader.playlist(media, requestOptions);
      segmentLoader.track(mediaType.activeTrack()); // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments

      if (!tech.paused() || media.endList && tech.preload() !== 'none') {
        segmentLoader.load();
      }
    });
    playlistLoader.on('loadedplaylist', function () {
      segmentLoader.playlist(playlistLoader.media(), requestOptions); // If the player isn't paused, ensure that the segment loader is running

      if (!tech.paused()) {
        segmentLoader.load();
      }
    });
    playlistLoader.on('error', onError[type](type, settings));
  }
};
var initialize = {
  /**
   * Setup PlaylistLoaders and AudioTracks for the audio groups
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize.AUDIO
   */
  'AUDIO': function AUDIO(type, settings) {
    var vhs = settings.vhs,
        sourceType = settings.sourceType,
        segmentLoader = settings.segmentLoaders[type],
        requestOptions = settings.requestOptions,
        mediaGroups = settings.main.mediaGroups,
        _settings$mediaTypes$ = settings.mediaTypes[type],
        groups = _settings$mediaTypes$.groups,
        tracks = _settings$mediaTypes$.tracks,
        logger_ = _settings$mediaTypes$.logger_,
        mainPlaylistLoader = settings.mainPlaylistLoader;
    var audioOnlyMain = isAudioOnly(mainPlaylistLoader.main); // force a default if we have none

    if (!mediaGroups[type] || Object.keys(mediaGroups[type]).length === 0) {
      mediaGroups[type] = {
        main: {
          default: {
            default: true
          }
        }
      };

      if (audioOnlyMain) {
        mediaGroups[type].main.default.playlists = mainPlaylistLoader.main.playlists;
      }
    }

    for (var groupId in mediaGroups[type]) {
      if (!groups[groupId]) {
        groups[groupId] = [];
      }

      for (var variantLabel in mediaGroups[type][groupId]) {
        var properties = mediaGroups[type][groupId][variantLabel];
        var playlistLoader = void 0;

        if (audioOnlyMain) {
          logger_("AUDIO group '" + groupId + "' label '" + variantLabel + "' is a main playlist");
          properties.isMainPlaylist = true;
          playlistLoader = null; // if vhs-json was provided as the source, and the media playlist was resolved,
          // use the resolved media playlist object
        } else if (sourceType === 'vhs-json' && properties.playlists) {
          playlistLoader = new PlaylistLoader(properties.playlists[0], vhs, requestOptions);
        } else if (properties.resolvedUri) {
          playlistLoader = new PlaylistLoader(properties.resolvedUri, vhs, requestOptions); // TODO: dash isn't the only type with properties.playlists
          // should we even have properties.playlists in this check.
        } else if (properties.playlists && sourceType === 'dash') {
          playlistLoader = new DashPlaylistLoader(properties.playlists[0], vhs, requestOptions, mainPlaylistLoader);
        } else {
          // no resolvedUri means the audio is muxed with the video when using this
          // audio track
          playlistLoader = null;
        }

        properties = merge({
          id: variantLabel,
          playlistLoader: playlistLoader
        }, properties);
        setupListeners[type](type, properties.playlistLoader, settings);
        groups[groupId].push(properties);

        if (typeof tracks[variantLabel] === 'undefined') {
          var track = new videojs.AudioTrack({
            id: variantLabel,
            kind: audioTrackKind_(properties),
            enabled: false,
            language: properties.language,
            default: properties.default,
            label: variantLabel
          });
          tracks[variantLabel] = track;
        }
      }
    } // setup single error event handler for the segment loader


    segmentLoader.on('error', onError[type](type, settings));
  },

  /**
   * Setup PlaylistLoaders and TextTracks for the subtitle groups
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize.SUBTITLES
   */
  'SUBTITLES': function SUBTITLES(type, settings) {
    var tech = settings.tech,
        vhs = settings.vhs,
        sourceType = settings.sourceType,
        segmentLoader = settings.segmentLoaders[type],
        requestOptions = settings.requestOptions,
        mediaGroups = settings.main.mediaGroups,
        _settings$mediaTypes$2 = settings.mediaTypes[type],
        groups = _settings$mediaTypes$2.groups,
        tracks = _settings$mediaTypes$2.tracks,
        mainPlaylistLoader = settings.mainPlaylistLoader;

    for (var groupId in mediaGroups[type]) {
      if (!groups[groupId]) {
        groups[groupId] = [];
      }

      for (var variantLabel in mediaGroups[type][groupId]) {
        if (!vhs.options_.useForcedSubtitles && mediaGroups[type][groupId][variantLabel].forced) {
          // Subtitle playlists with the forced attribute are not selectable in Safari.
          // According to Apple's HLS Authoring Specification:
          //   If content has forced subtitles and regular subtitles in a given language,
          //   the regular subtitles track in that language MUST contain both the forced
          //   subtitles and the regular subtitles for that language.
          // Because of this requirement and that Safari does not add forced subtitles,
          // forced subtitles are skipped here to maintain consistent experience across
          // all platforms
          continue;
        }

        var properties = mediaGroups[type][groupId][variantLabel];
        var playlistLoader = void 0;

        if (sourceType === 'hls') {
          playlistLoader = new PlaylistLoader(properties.resolvedUri, vhs, requestOptions);
        } else if (sourceType === 'dash') {
          var playlists = properties.playlists.filter(function (p) {
            return p.excludeUntil !== Infinity;
          });

          if (!playlists.length) {
            return;
          }

          playlistLoader = new DashPlaylistLoader(properties.playlists[0], vhs, requestOptions, mainPlaylistLoader);
        } else if (sourceType === 'vhs-json') {
          playlistLoader = new PlaylistLoader( // if the vhs-json object included the media playlist, use the media playlist
          // as provided, otherwise use the resolved URI to load the playlist
          properties.playlists ? properties.playlists[0] : properties.resolvedUri, vhs, requestOptions);
        }

        properties = merge({
          id: variantLabel,
          playlistLoader: playlistLoader
        }, properties);
        setupListeners[type](type, properties.playlistLoader, settings);
        groups[groupId].push(properties);

        if (typeof tracks[variantLabel] === 'undefined') {
          var track = tech.addRemoteTextTrack({
            id: variantLabel,
            kind: 'subtitles',
            default: properties.default && properties.autoselect,
            language: properties.language,
            label: variantLabel
          }, false).track;
          tracks[variantLabel] = track;
        }
      }
    } // setup single error event handler for the segment loader


    segmentLoader.on('error', onError[type](type, settings));
  },

  /**
   * Setup TextTracks for the closed-caption groups
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize['CLOSED-CAPTIONS']
   */
  'CLOSED-CAPTIONS': function CLOSEDCAPTIONS(type, settings) {
    var tech = settings.tech,
        mediaGroups = settings.main.mediaGroups,
        _settings$mediaTypes$3 = settings.mediaTypes[type],
        groups = _settings$mediaTypes$3.groups,
        tracks = _settings$mediaTypes$3.tracks;

    for (var groupId in mediaGroups[type]) {
      if (!groups[groupId]) {
        groups[groupId] = [];
      }

      for (var variantLabel in mediaGroups[type][groupId]) {
        var properties = mediaGroups[type][groupId][variantLabel]; // Look for either 608 (CCn) or 708 (SERVICEn) caption services

        if (!/^(?:CC|SERVICE)/.test(properties.instreamId)) {
          continue;
        }

        var captionServices = tech.options_.vhs && tech.options_.vhs.captionServices || {};
        var newProps = {
          label: variantLabel,
          language: properties.language,
          instreamId: properties.instreamId,
          default: properties.default && properties.autoselect
        };

        if (captionServices[newProps.instreamId]) {
          newProps = merge(newProps, captionServices[newProps.instreamId]);
        }

        if (newProps.default === undefined) {
          delete newProps.default;
        } // No PlaylistLoader is required for Closed-Captions because the captions are
        // embedded within the video stream


        groups[groupId].push(merge({
          id: variantLabel
        }, properties));

        if (typeof tracks[variantLabel] === 'undefined') {
          var track = tech.addRemoteTextTrack({
            id: newProps.instreamId,
            kind: 'captions',
            default: newProps.default,
            language: newProps.language,
            label: newProps.label
          }, false).track;
          tracks[variantLabel] = track;
        }
      }
    }
  }
};

var groupMatch = function groupMatch(list, media) {
  for (var i = 0; i < list.length; i++) {
    if (playlistMatch(media, list[i])) {
      return true;
    }

    if (list[i].playlists && groupMatch(list[i].playlists, media)) {
      return true;
    }
  }

  return false;
};
/**
 * Returns a function used to get the active group of the provided type
 *
 * @param {string} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Function that returns the active media group for the provided type. Takes an
 *         optional parameter {TextTrack} track. If no track is provided, a list of all
 *         variants in the group, otherwise the variant corresponding to the provided
 *         track is returned.
 * @function activeGroup
 */


var activeGroup = function activeGroup(type, settings) {
  return function (track) {
    var mainPlaylistLoader = settings.mainPlaylistLoader,
        groups = settings.mediaTypes[type].groups;
    var media = mainPlaylistLoader.media();

    if (!media) {
      return null;
    }

    var variants = null; // set to variants to main media active group

    if (media.attributes[type]) {
      variants = groups[media.attributes[type]];
    }

    var groupKeys = Object.keys(groups);

    if (!variants) {
      // find the mainPlaylistLoader media
      // that is in a media group if we are dealing
      // with audio only
      if (type === 'AUDIO' && groupKeys.length > 1 && isAudioOnly(settings.main)) {
        for (var i = 0; i < groupKeys.length; i++) {
          var groupPropertyList = groups[groupKeys[i]];

          if (groupMatch(groupPropertyList, media)) {
            variants = groupPropertyList;
            break;
          }
        } // use the main group if it exists

      } else if (groups.main) {
        variants = groups.main; // only one group, use that one
      } else if (groupKeys.length === 1) {
        variants = groups[groupKeys[0]];
      }
    }

    if (typeof track === 'undefined') {
      return variants;
    }

    if (track === null || !variants) {
      // An active track was specified so a corresponding group is expected. track === null
      // means no track is currently active so there is no corresponding group
      return null;
    }

    return variants.filter(function (props) {
      return props.id === track.id;
    })[0] || null;
  };
};
var activeTrack = {
  /**
   * Returns a function used to get the active track of type provided
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Function that returns the active media track for the provided type. Returns
   *         null if no track is active
   * @function activeTrack.AUDIO
   */
  AUDIO: function AUDIO(type, settings) {
    return function () {
      var tracks = settings.mediaTypes[type].tracks;

      for (var id in tracks) {
        if (tracks[id].enabled) {
          return tracks[id];
        }
      }

      return null;
    };
  },

  /**
   * Returns a function used to get the active track of type provided
   *
   * @param {string} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Function that returns the active media track for the provided type. Returns
   *         null if no track is active
   * @function activeTrack.SUBTITLES
   */
  SUBTITLES: function SUBTITLES(type, settings) {
    return function () {
      var tracks = settings.mediaTypes[type].tracks;

      for (var id in tracks) {
        if (tracks[id].mode === 'showing' || tracks[id].mode === 'hidden') {
          return tracks[id];
        }
      }

      return null;
    };
  }
};
var getActiveGroup = function getActiveGroup(type, _ref) {
  var mediaTypes = _ref.mediaTypes;
  return function () {
    var activeTrack_ = mediaTypes[type].activeTrack();

    if (!activeTrack_) {
      return null;
    }

    return mediaTypes[type].activeGroup(activeTrack_);
  };
};
/**
 * Setup PlaylistLoaders and Tracks for media groups (Audio, Subtitles,
 * Closed-Captions) specified in the main manifest.
 *
 * @param {Object} settings
 *        Object containing required information for setting up the media groups
 * @param {Tech} settings.tech
 *        The tech of the player
 * @param {Object} settings.requestOptions
 *        XHR request options used by the segment loaders
 * @param {PlaylistLoader} settings.mainPlaylistLoader
 *        PlaylistLoader for the main source
 * @param {VhsHandler} settings.vhs
 *        VHS SourceHandler
 * @param {Object} settings.main
 *        The parsed main manifest
 * @param {Object} settings.mediaTypes
 *        Object to store the loaders, tracks, and utility methods for each media type
 * @param {Function} settings.excludePlaylist
 *        Excludes the current rendition and forces a rendition switch.
 * @function setupMediaGroups
 */

var setupMediaGroups = function setupMediaGroups(settings) {
  ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (type) {
    initialize[type](type, settings);
  });
  var mediaTypes = settings.mediaTypes,
      mainPlaylistLoader = settings.mainPlaylistLoader,
      tech = settings.tech,
      vhs = settings.vhs,
      _settings$segmentLoad3 = settings.segmentLoaders,
      audioSegmentLoader = _settings$segmentLoad3['AUDIO'],
      mainSegmentLoader = _settings$segmentLoad3.main; // setup active group and track getters and change event handlers

  ['AUDIO', 'SUBTITLES'].forEach(function (type) {
    mediaTypes[type].activeGroup = activeGroup(type, settings);
    mediaTypes[type].activeTrack = activeTrack[type](type, settings);
    mediaTypes[type].onGroupChanged = onGroupChanged(type, settings);
    mediaTypes[type].onGroupChanging = onGroupChanging(type, settings);
    mediaTypes[type].onTrackChanged = onTrackChanged(type, settings);
    mediaTypes[type].getActiveGroup = getActiveGroup(type, settings);
  }); // DO NOT enable the default subtitle or caption track.
  // DO enable the default audio track

  var audioGroup = mediaTypes.AUDIO.activeGroup();

  if (audioGroup) {
    var groupId = (audioGroup.filter(function (group) {
      return group.default;
    })[0] || audioGroup[0]).id;
    mediaTypes.AUDIO.tracks[groupId].enabled = true;
    mediaTypes.AUDIO.onGroupChanged();
    mediaTypes.AUDIO.onTrackChanged();
    var activeAudioGroup = mediaTypes.AUDIO.getActiveGroup(); // a similar check for handling setAudio on each loader is run again each time the
    // track is changed, but needs to be handled here since the track may not be considered
    // changed on the first call to onTrackChanged

    if (!activeAudioGroup.playlistLoader) {
      // either audio is muxed with video or the stream is audio only
      mainSegmentLoader.setAudio(true);
    } else {
      // audio is demuxed
      mainSegmentLoader.setAudio(false);
      audioSegmentLoader.setAudio(true);
    }
  }

  mainPlaylistLoader.on('mediachange', function () {
    ['AUDIO', 'SUBTITLES'].forEach(function (type) {
      return mediaTypes[type].onGroupChanged();
    });
  });
  mainPlaylistLoader.on('mediachanging', function () {
    ['AUDIO', 'SUBTITLES'].forEach(function (type) {
      return mediaTypes[type].onGroupChanging();
    });
  }); // custom audio track change event handler for usage event

  var onAudioTrackChanged = function onAudioTrackChanged() {
    mediaTypes.AUDIO.onTrackChanged();
    tech.trigger({
      type: 'usage',
      name: 'vhs-audio-change'
    });
  };

  tech.audioTracks().addEventListener('change', onAudioTrackChanged);
  tech.remoteTextTracks().addEventListener('change', mediaTypes.SUBTITLES.onTrackChanged);
  vhs.on('dispose', function () {
    tech.audioTracks().removeEventListener('change', onAudioTrackChanged);
    tech.remoteTextTracks().removeEventListener('change', mediaTypes.SUBTITLES.onTrackChanged);
  }); // clear existing audio tracks and add the ones we just created

  tech.clearTracks('audio');

  for (var id in mediaTypes.AUDIO.tracks) {
    tech.audioTracks().addTrack(mediaTypes.AUDIO.tracks[id]);
  }
};
/**
 * Creates skeleton object used to store the loaders, tracks, and utility methods for each
 * media type
 *
 * @return {Object}
 *         Object to store the loaders, tracks, and utility methods for each media type
 * @function createMediaTypes
 */

var createMediaTypes = function createMediaTypes() {
  var mediaTypes = {};
  ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (type) {
    mediaTypes[type] = {
      groups: {},
      tracks: {},
      activePlaylistLoader: null,
      activeGroup: noop,
      activeTrack: noop,
      getActiveGroup: noop,
      onGroupChanged: noop,
      onTrackChanged: noop,
      lastTrack_: null,
      logger_: logger("MediaGroups[" + type + "]")
    };
  });
  return mediaTypes;
};

function _createForOfIteratorHelperLoose$1(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (it) return (it = it.call(o)).next.bind(it); if (Array.isArray(o) || (it = _unsupportedIterableToArray$1(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; return function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray$1(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray$1(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$1(o, minLen); }

function _arrayLikeToArray$1(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
/**
 * A utility class for setting properties and maintaining the state of the content steering manifest.
 *
 * Content Steering manifest format:
 * VERSION: number (required) currently only version 1 is supported.
 * TTL: number in seconds (optional) until the next content steering manifest reload.
 * RELOAD-URI: string (optional) uri to fetch the next content steering manifest.
 * SERVICE-LOCATION-PRIORITY or PATHWAY-PRIORITY a non empty array of unique string values.
 * PATHWAY-CLONES: array (optional) (HLS only) pathway clone objects to copy from other playlists.
 */

var SteeringManifest = /*#__PURE__*/function () {
  function SteeringManifest() {
    this.priority_ = [];
    this.pathwayClones_ = new Map();
  }

  _createClass(SteeringManifest, [{
    key: "version",
    get: function get() {
      return this.version_;
    },
    set: function set(number) {
      // Only version 1 is currently supported for both DASH and HLS.
      if (number === 1) {
        this.version_ = number;
      }
    }
  }, {
    key: "ttl",
    get: function get() {
      return this.ttl_;
    },
    set: function set(seconds) {
      // TTL = time-to-live, default = 300 seconds.
      this.ttl_ = seconds || 300;
    }
  }, {
    key: "reloadUri",
    get: function get() {
      return this.reloadUri_;
    },
    set: function set(uri) {
      if (uri) {
        // reload URI can be relative to the previous reloadUri.
        this.reloadUri_ = resolveUrl(this.reloadUri_, uri);
      }
    }
  }, {
    key: "priority",
    get: function get() {
      return this.priority_;
    },
    set: function set(array) {
      // priority must be non-empty and unique values.
      if (array && array.length) {
        this.priority_ = array;
      }
    }
  }, {
    key: "pathwayClones",
    get: function get() {
      return this.pathwayClones_;
    },
    set: function set(array) {
      // pathwayClones must be non-empty.
      if (array && array.length) {
        this.pathwayClones_ = new Map(array.map(function (clone) {
          return [clone.ID, clone];
        }));
      }
    }
  }]);

  return SteeringManifest;
}();
/**
 * This class represents a content steering manifest and associated state. See both HLS and DASH specifications.
 * HLS: https://developer.apple.com/streaming/HLSContentSteeringSpecification.pdf and
 * https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/ section 4.4.6.6.
 * DASH: https://dashif.org/docs/DASH-IF-CTS-00XX-Content-Steering-Community-Review.pdf
 *
 * @param {function} xhr for making a network request from the browser.
 * @param {function} bandwidth for fetching the current bandwidth from the main segment loader.
 */


var ContentSteeringController = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(ContentSteeringController, _videojs$EventTarget);

  function ContentSteeringController(xhr, bandwidth) {
    var _this;

    _this = _videojs$EventTarget.call(this) || this;
    _this.currentPathway = null;
    _this.defaultPathway = null;
    _this.queryBeforeStart = false;
    _this.availablePathways_ = new Set();
    _this.steeringManifest = new SteeringManifest();
    _this.proxyServerUrl_ = null;
    _this.manifestType_ = null;
    _this.ttlTimeout_ = null;
    _this.request_ = null;
    _this.currentPathwayClones = new Map();
    _this.nextPathwayClones = new Map();
    _this.excludedSteeringManifestURLs = new Set();
    _this.logger_ = logger('Content Steering');
    _this.xhr_ = xhr;
    _this.getBandwidth_ = bandwidth;
    return _this;
  }
  /**
   * Assigns the content steering tag properties to the steering controller
   *
   * @param {string} baseUrl the baseURL from the main manifest for resolving the steering manifest url
   * @param {Object} steeringTag the content steering tag from the main manifest
   */


  var _proto = ContentSteeringController.prototype;

  _proto.assignTagProperties = function assignTagProperties(baseUrl, steeringTag) {
    this.manifestType_ = steeringTag.serverUri ? 'HLS' : 'DASH'; // serverUri is HLS serverURL is DASH

    var steeringUri = steeringTag.serverUri || steeringTag.serverURL;

    if (!steeringUri) {
      this.logger_("steering manifest URL is " + steeringUri + ", cannot request steering manifest.");
      this.trigger('error');
      return;
    } // Content steering manifests can be encoded as a data URI. We can decode, parse and return early if that's the case.


    if (steeringUri.startsWith('data:')) {
      this.decodeDataUriManifest_(steeringUri.substring(steeringUri.indexOf(',') + 1));
      return;
    } // reloadUri is the resolution of the main manifest URL and steering URL.


    this.steeringManifest.reloadUri = resolveUrl(baseUrl, steeringUri); // pathwayId is HLS defaultServiceLocation is DASH

    this.defaultPathway = steeringTag.pathwayId || steeringTag.defaultServiceLocation; // currently only DASH supports the following properties on <ContentSteering> tags.

    this.queryBeforeStart = steeringTag.queryBeforeStart;
    this.proxyServerUrl_ = steeringTag.proxyServerURL; // trigger a steering event if we have a pathway from the content steering tag.
    // this tells VHS which segment pathway to start with.
    // If queryBeforeStart is true we need to wait for the steering manifest response.

    if (this.defaultPathway && !this.queryBeforeStart) {
      this.trigger('content-steering');
    }
  }
  /**
   * Requests the content steering manifest and parse the response. This should only be called after
   * assignTagProperties was called with a content steering tag.
   *
   * @param {string} initialUri The optional uri to make the request with.
   *    If set, the request should be made with exactly what is passed in this variable.
   *    This scenario should only happen once on initalization.
   */
  ;

  _proto.requestSteeringManifest = function requestSteeringManifest(initial) {
    var _this2 = this;

    var reloadUri = this.steeringManifest.reloadUri;

    if (!reloadUri) {
      return;
    } // We currently don't support passing MPD query parameters directly to the content steering URL as this requires
    // ExtUrlQueryInfo tag support. See the DASH content steering spec section 8.1.
    // This request URI accounts for manifest URIs that have been excluded.


    var uri = initial ? reloadUri : this.getRequestURI(reloadUri); // If there are no valid manifest URIs, we should stop content steering.

    if (!uri) {
      this.logger_('No valid content steering manifest URIs. Stopping content steering.');
      this.trigger('error');
      this.dispose();
      return;
    }

    this.request_ = this.xhr_({
      uri: uri,
      requestType: 'content-steering-manifest'
    }, function (error, errorInfo) {
      if (error) {
        // If the client receives HTTP 410 Gone in response to a manifest request,
        // it MUST NOT issue another request for that URI for the remainder of the
        // playback session. It MAY continue to use the most-recently obtained set
        // of Pathways.
        if (errorInfo.status === 410) {
          _this2.logger_("manifest request 410 " + error + ".");

          _this2.logger_("There will be no more content steering requests to " + uri + " this session.");

          _this2.excludedSteeringManifestURLs.add(uri);

          return;
        } // If the client receives HTTP 429 Too Many Requests with a Retry-After
        // header in response to a manifest request, it SHOULD wait until the time
        // specified by the Retry-After header to reissue the request.


        if (errorInfo.status === 429) {
          var retrySeconds = errorInfo.responseHeaders['retry-after'];

          _this2.logger_("manifest request 429 " + error + ".");

          _this2.logger_("content steering will retry in " + retrySeconds + " seconds.");

          _this2.startTTLTimeout_(parseInt(retrySeconds, 10));

          return;
        } // If the Steering Manifest cannot be loaded and parsed correctly, the
        // client SHOULD continue to use the previous values and attempt to reload
        // it after waiting for the previously-specified TTL (or 5 minutes if
        // none).


        _this2.logger_("manifest failed to load " + error + ".");

        _this2.startTTLTimeout_();

        return;
      }

      var steeringManifestJson = JSON.parse(_this2.request_.responseText);

      _this2.assignSteeringProperties_(steeringManifestJson);

      _this2.startTTLTimeout_();
    });
  }
  /**
   * Set the proxy server URL and add the steering manifest url as a URI encoded parameter.
   *
   * @param {string} steeringUrl the steering manifest url
   * @return the steering manifest url to a proxy server with all parameters set
   */
  ;

  _proto.setProxyServerUrl_ = function setProxyServerUrl_(steeringUrl) {
    var steeringUrlObject = new window$1.URL(steeringUrl);
    var proxyServerUrlObject = new window$1.URL(this.proxyServerUrl_);
    proxyServerUrlObject.searchParams.set('url', encodeURI(steeringUrlObject.toString()));
    return this.setSteeringParams_(proxyServerUrlObject.toString());
  }
  /**
   * Decodes and parses the data uri encoded steering manifest
   *
   * @param {string} dataUri the data uri to be decoded and parsed.
   */
  ;

  _proto.decodeDataUriManifest_ = function decodeDataUriManifest_(dataUri) {
    var steeringManifestJson = JSON.parse(window$1.atob(dataUri));
    this.assignSteeringProperties_(steeringManifestJson);
  }
  /**
   * Set the HLS or DASH content steering manifest request query parameters. For example:
   * _HLS_pathway="<CURRENT-PATHWAY-ID>" and _HLS_throughput=<THROUGHPUT>
   * _DASH_pathway and _DASH_throughput
   *
   * @param {string} uri to add content steering server parameters to.
   * @return a new uri as a string with the added steering query parameters.
   */
  ;

  _proto.setSteeringParams_ = function setSteeringParams_(url) {
    var urlObject = new window$1.URL(url);
    var path = this.getPathway();
    var networkThroughput = this.getBandwidth_();

    if (path) {
      var pathwayKey = "_" + this.manifestType_ + "_pathway";
      urlObject.searchParams.set(pathwayKey, path);
    }

    if (networkThroughput) {
      var throughputKey = "_" + this.manifestType_ + "_throughput";
      urlObject.searchParams.set(throughputKey, networkThroughput);
    }

    return urlObject.toString();
  }
  /**
   * Assigns the current steering manifest properties and to the SteeringManifest object
   *
   * @param {Object} steeringJson the raw JSON steering manifest
   */
  ;

  _proto.assignSteeringProperties_ = function assignSteeringProperties_(steeringJson) {
    var _this3 = this;

    this.steeringManifest.version = steeringJson.VERSION;

    if (!this.steeringManifest.version) {
      this.logger_("manifest version is " + steeringJson.VERSION + ", which is not supported.");
      this.trigger('error');
      return;
    }

    this.steeringManifest.ttl = steeringJson.TTL;
    this.steeringManifest.reloadUri = steeringJson['RELOAD-URI']; // HLS = PATHWAY-PRIORITY required. DASH = SERVICE-LOCATION-PRIORITY optional

    this.steeringManifest.priority = steeringJson['PATHWAY-PRIORITY'] || steeringJson['SERVICE-LOCATION-PRIORITY']; // Pathway clones to be created/updated in HLS.
    // See section 7.2 https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/

    this.steeringManifest.pathwayClones = steeringJson['PATHWAY-CLONES'];
    this.nextPathwayClones = this.steeringManifest.pathwayClones; // 1. apply first pathway from the array.
    // 2. if first pathway doesn't exist in manifest, try next pathway.
    //    a. if all pathways are exhausted, ignore the steering manifest priority.
    // 3. if segments fail from an established pathway, try all variants/renditions, then exclude the failed pathway.
    //    a. exclude a pathway for a minimum of the last TTL duration. Meaning, from the next steering response,
    //       the excluded pathway will be ignored.
    //       See excludePathway usage in excludePlaylist().
    // If there are no available pathways, we need to stop content steering.

    if (!this.availablePathways_.size) {
      this.logger_('There are no available pathways for content steering. Ending content steering.');
      this.trigger('error');
      this.dispose();
    }

    var chooseNextPathway = function chooseNextPathway(pathwaysByPriority) {
      for (var _iterator = _createForOfIteratorHelperLoose$1(pathwaysByPriority), _step; !(_step = _iterator()).done;) {
        var path = _step.value;

        if (_this3.availablePathways_.has(path)) {
          return path;
        }
      } // If no pathway matches, ignore the manifest and choose the first available.


      return [].concat(_this3.availablePathways_)[0];
    };

    var nextPathway = chooseNextPathway(this.steeringManifest.priority);

    if (this.currentPathway !== nextPathway) {
      this.currentPathway = nextPathway;
      this.trigger('content-steering');
    }
  }
  /**
   * Returns the pathway to use for steering decisions
   *
   * @return {string} returns the current pathway or the default
   */
  ;

  _proto.getPathway = function getPathway() {
    return this.currentPathway || this.defaultPathway;
  }
  /**
   * Chooses the manifest request URI based on proxy URIs and server URLs.
   * Also accounts for exclusion on certain manifest URIs.
   *
   * @param {string} reloadUri the base uri before parameters
   *
   * @return {string} the final URI for the request to the manifest server.
   */
  ;

  _proto.getRequestURI = function getRequestURI(reloadUri) {
    var _this4 = this;

    if (!reloadUri) {
      return null;
    }

    var isExcluded = function isExcluded(uri) {
      return _this4.excludedSteeringManifestURLs.has(uri);
    };

    if (this.proxyServerUrl_) {
      var proxyURI = this.setProxyServerUrl_(reloadUri);

      if (!isExcluded(proxyURI)) {
        return proxyURI;
      }
    }

    var steeringURI = this.setSteeringParams_(reloadUri);

    if (!isExcluded(steeringURI)) {
      return steeringURI;
    } // Return nothing if all valid manifest URIs are excluded.


    return null;
  }
  /**
   * Start the timeout for re-requesting the steering manifest at the TTL interval.
   *
   * @param {number} ttl time in seconds of the timeout. Defaults to the
   *        ttl interval in the steering manifest
   */
  ;

  _proto.startTTLTimeout_ = function startTTLTimeout_(ttl) {
    var _this5 = this;

    if (ttl === void 0) {
      ttl = this.steeringManifest.ttl;
    }

    // 300 (5 minutes) is the default value.
    var ttlMS = ttl * 1000;
    this.ttlTimeout_ = window$1.setTimeout(function () {
      _this5.requestSteeringManifest();
    }, ttlMS);
  }
  /**
   * Clear the TTL timeout if necessary.
   */
  ;

  _proto.clearTTLTimeout_ = function clearTTLTimeout_() {
    window$1.clearTimeout(this.ttlTimeout_);
    this.ttlTimeout_ = null;
  }
  /**
   * aborts any current steering xhr and sets the current request object to null
   */
  ;

  _proto.abort = function abort() {
    if (this.request_) {
      this.request_.abort();
    }

    this.request_ = null;
  }
  /**
   * aborts steering requests clears the ttl timeout and resets all properties.
   */
  ;

  _proto.dispose = function dispose() {
    this.off('content-steering');
    this.off('error');
    this.abort();
    this.clearTTLTimeout_();
    this.currentPathway = null;
    this.defaultPathway = null;
    this.queryBeforeStart = null;
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.excludedSteeringManifestURLs = new Set();
    this.availablePathways_ = new Set();
    this.steeringManifest = new SteeringManifest();
  }
  /**
   * adds a pathway to the available pathways set
   *
   * @param {string} pathway the pathway string to add
   */
  ;

  _proto.addAvailablePathway = function addAvailablePathway(pathway) {
    if (pathway) {
      this.availablePathways_.add(pathway);
    }
  }
  /**
   * Clears all pathways from the available pathways set
   */
  ;

  _proto.clearAvailablePathways = function clearAvailablePathways() {
    this.availablePathways_.clear();
  }
  /**
   * Removes a pathway from the available pathways set.
   */
  ;

  _proto.excludePathway = function excludePathway(pathway) {
    return this.availablePathways_.delete(pathway);
  }
  /**
   * Checks the refreshed DASH manifest content steering tag for changes.
   *
   * @param {string} baseURL new steering tag on DASH manifest refresh
   * @param {Object} newTag the new tag to check for changes
   * @return a true or false whether the new tag has different values
   */
  ;

  _proto.didDASHTagChange = function didDASHTagChange(baseURL, newTag) {
    return !newTag && this.steeringManifest.reloadUri || newTag && (resolveUrl(baseURL, newTag.serverURL) !== this.steeringManifest.reloadUri || newTag.defaultServiceLocation !== this.defaultPathway || newTag.queryBeforeStart !== this.queryBeforeStart || newTag.proxyServerURL !== this.proxyServerUrl_);
  };

  _proto.getAvailablePathways = function getAvailablePathways() {
    return this.availablePathways_;
  };

  return ContentSteeringController;
}(videojs.EventTarget);

function _createForOfIteratorHelperLoose(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (it) return (it = it.call(o)).next.bind(it); if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; return function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
var ABORT_EARLY_EXCLUSION_SECONDS = 10;
var Vhs$1; // SegmentLoader stats that need to have each loader's
// values summed to calculate the final value

var loaderStats = ['mediaRequests', 'mediaRequestsAborted', 'mediaRequestsTimedout', 'mediaRequestsErrored', 'mediaTransferDuration', 'mediaBytesTransferred', 'mediaAppends'];

var sumLoaderStat = function sumLoaderStat(stat) {
  return this.audioSegmentLoader_[stat] + this.mainSegmentLoader_[stat];
};

var shouldSwitchToMedia = function shouldSwitchToMedia(_ref) {
  var currentPlaylist = _ref.currentPlaylist,
      buffered = _ref.buffered,
      currentTime = _ref.currentTime,
      nextPlaylist = _ref.nextPlaylist,
      bufferLowWaterLine = _ref.bufferLowWaterLine,
      bufferHighWaterLine = _ref.bufferHighWaterLine,
      duration = _ref.duration,
      bufferBasedABR = _ref.bufferBasedABR,
      log = _ref.log;

  // we have no other playlist to switch to
  if (!nextPlaylist) {
    videojs.log.warn('We received no playlist to switch to. Please check your stream.');
    return false;
  }

  var sharedLogLine = "allowing switch " + (currentPlaylist && currentPlaylist.id || 'null') + " -> " + nextPlaylist.id;

  if (!currentPlaylist) {
    log(sharedLogLine + " as current playlist is not set");
    return true;
  } // no need to switch if playlist is the same


  if (nextPlaylist.id === currentPlaylist.id) {
    return false;
  } // determine if current time is in a buffered range.


  var isBuffered = Boolean(findRange(buffered, currentTime).length); // If the playlist is live, then we want to not take low water line into account.
  // This is because in LIVE, the player plays 3 segments from the end of the
  // playlist, and if `BUFFER_LOW_WATER_LINE` is greater than the duration availble
  // in those segments, a viewer will never experience a rendition upswitch.

  if (!currentPlaylist.endList) {
    // For LLHLS live streams, don't switch renditions before playback has started, as it almost
    // doubles the time to first playback.
    if (!isBuffered && typeof currentPlaylist.partTargetDuration === 'number') {
      log("not " + sharedLogLine + " as current playlist is live llhls, but currentTime isn't in buffered.");
      return false;
    }

    log(sharedLogLine + " as current playlist is live");
    return true;
  }

  var forwardBuffer = timeAheadOf(buffered, currentTime);
  var maxBufferLowWaterLine = bufferBasedABR ? Config.EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE : Config.MAX_BUFFER_LOW_WATER_LINE; // For the same reason as LIVE, we ignore the low water line when the VOD
  // duration is below the max potential low water line

  if (duration < maxBufferLowWaterLine) {
    log(sharedLogLine + " as duration < max low water line (" + duration + " < " + maxBufferLowWaterLine + ")");
    return true;
  }

  var nextBandwidth = nextPlaylist.attributes.BANDWIDTH;
  var currBandwidth = currentPlaylist.attributes.BANDWIDTH; // when switching down, if our buffer is lower than the high water line,
  // we can switch down

  if (nextBandwidth < currBandwidth && (!bufferBasedABR || forwardBuffer < bufferHighWaterLine)) {
    var logLine = sharedLogLine + " as next bandwidth < current bandwidth (" + nextBandwidth + " < " + currBandwidth + ")";

    if (bufferBasedABR) {
      logLine += " and forwardBuffer < bufferHighWaterLine (" + forwardBuffer + " < " + bufferHighWaterLine + ")";
    }

    log(logLine);
    return true;
  } // and if our buffer is higher than the low water line,
  // we can switch up


  if ((!bufferBasedABR || nextBandwidth > currBandwidth) && forwardBuffer >= bufferLowWaterLine) {
    var _logLine = sharedLogLine + " as forwardBuffer >= bufferLowWaterLine (" + forwardBuffer + " >= " + bufferLowWaterLine + ")";

    if (bufferBasedABR) {
      _logLine += " and next bandwidth > current bandwidth (" + nextBandwidth + " > " + currBandwidth + ")";
    }

    log(_logLine);
    return true;
  }

  log("not " + sharedLogLine + " as no switching criteria met");
  return false;
};
/**
 * the main playlist controller controller all interactons
 * between playlists and segmentloaders. At this time this mainly
 * involves a main playlist and a series of audio playlists
 * if they are available
 *
 * @class PlaylistController
 * @extends videojs.EventTarget
 */


var PlaylistController = /*#__PURE__*/function (_videojs$EventTarget) {
  _inheritsLoose(PlaylistController, _videojs$EventTarget);

  function PlaylistController(options) {
    var _this;

    _this = _videojs$EventTarget.call(this) || this;
    var src = options.src,
        withCredentials = options.withCredentials,
        tech = options.tech,
        bandwidth = options.bandwidth,
        externVhs = options.externVhs,
        useCueTags = options.useCueTags,
        playlistExclusionDuration = options.playlistExclusionDuration,
        enableLowInitialPlaylist = options.enableLowInitialPlaylist,
        sourceType = options.sourceType,
        cacheEncryptionKeys = options.cacheEncryptionKeys,
        bufferBasedABR = options.bufferBasedABR,
        leastPixelDiffSelector = options.leastPixelDiffSelector,
        captionServices = options.captionServices;

    if (!src) {
      throw new Error('A non-empty playlist URL or JSON manifest string is required');
    }

    var maxPlaylistRetries = options.maxPlaylistRetries;

    if (maxPlaylistRetries === null || typeof maxPlaylistRetries === 'undefined') {
      maxPlaylistRetries = Infinity;
    }

    Vhs$1 = externVhs;
    _this.bufferBasedABR = Boolean(bufferBasedABR);
    _this.leastPixelDiffSelector = Boolean(leastPixelDiffSelector);
    _this.withCredentials = withCredentials;
    _this.tech_ = tech;
    _this.vhs_ = tech.vhs;
    _this.sourceType_ = sourceType;
    _this.useCueTags_ = useCueTags;
    _this.playlistExclusionDuration = playlistExclusionDuration;
    _this.maxPlaylistRetries = maxPlaylistRetries;
    _this.enableLowInitialPlaylist = enableLowInitialPlaylist;

    if (_this.useCueTags_) {
      _this.cueTagsTrack_ = _this.tech_.addTextTrack('metadata', 'ad-cues');
      _this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    _this.requestOptions_ = {
      withCredentials: withCredentials,
      maxPlaylistRetries: maxPlaylistRetries,
      timeout: null
    };

    _this.on('error', _this.pauseLoading);

    _this.mediaTypes_ = createMediaTypes();
    _this.mediaSource = new window$1.MediaSource();
    _this.handleDurationChange_ = _this.handleDurationChange_.bind(_assertThisInitialized(_this));
    _this.handleSourceOpen_ = _this.handleSourceOpen_.bind(_assertThisInitialized(_this));
    _this.handleSourceEnded_ = _this.handleSourceEnded_.bind(_assertThisInitialized(_this));

    _this.mediaSource.addEventListener('durationchange', _this.handleDurationChange_); // load the media source into the player


    _this.mediaSource.addEventListener('sourceopen', _this.handleSourceOpen_);

    _this.mediaSource.addEventListener('sourceended', _this.handleSourceEnded_); // we don't have to handle sourceclose since dispose will handle termination of
    // everything, and the MediaSource should not be detached without a proper disposal


    _this.seekable_ = createTimeRanges();
    _this.hasPlayed_ = false;
    _this.syncController_ = new SyncController(options);
    _this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, false).track;
    _this.decrypter_ = new Decrypter();
    _this.sourceUpdater_ = new SourceUpdater(_this.mediaSource);
    _this.inbandTextTracks_ = {};
    _this.timelineChangeController_ = new TimelineChangeController();
    _this.keyStatusMap_ = new Map();
    var segmentLoaderSettings = {
      vhs: _this.vhs_,
      parse708captions: options.parse708captions,
      useDtsForTimestampOffset: options.useDtsForTimestampOffset,
      captionServices: captionServices,
      mediaSource: _this.mediaSource,
      currentTime: _this.tech_.currentTime.bind(_this.tech_),
      seekable: function seekable() {
        return _this.seekable();
      },
      seeking: function seeking() {
        return _this.tech_.seeking();
      },
      duration: function duration() {
        return _this.duration();
      },
      hasPlayed: function hasPlayed() {
        return _this.hasPlayed_;
      },
      goalBufferLength: function goalBufferLength() {
        return _this.goalBufferLength();
      },
      bandwidth: bandwidth,
      syncController: _this.syncController_,
      decrypter: _this.decrypter_,
      sourceType: _this.sourceType_,
      inbandTextTracks: _this.inbandTextTracks_,
      cacheEncryptionKeys: cacheEncryptionKeys,
      sourceUpdater: _this.sourceUpdater_,
      timelineChangeController: _this.timelineChangeController_,
      exactManifestTimings: options.exactManifestTimings,
      addMetadataToTextTrack: _this.addMetadataToTextTrack.bind(_assertThisInitialized(_this))
    }; // The source type check not only determines whether a special DASH playlist loader
    // should be used, but also covers the case where the provided src is a vhs-json
    // manifest object (instead of a URL). In the case of vhs-json, the default
    // PlaylistLoader should be used.

    _this.mainPlaylistLoader_ = _this.sourceType_ === 'dash' ? new DashPlaylistLoader(src, _this.vhs_, merge(_this.requestOptions_, {
      addMetadataToTextTrack: _this.addMetadataToTextTrack.bind(_assertThisInitialized(_this))
    })) : new PlaylistLoader(src, _this.vhs_, merge(_this.requestOptions_, {
      addDateRangesToTextTrack: _this.addDateRangesToTextTrack_.bind(_assertThisInitialized(_this))
    }));

    _this.setupMainPlaylistLoaderListeners_(); // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected


    _this.mainSegmentLoader_ = new SegmentLoader(merge(segmentLoaderSettings, {
      segmentMetadataTrack: _this.segmentMetadataTrack_,
      loaderType: 'main'
    }), options); // alternate audio track

    _this.audioSegmentLoader_ = new SegmentLoader(merge(segmentLoaderSettings, {
      loaderType: 'audio'
    }), options);
    _this.subtitleSegmentLoader_ = new VTTSegmentLoader(merge(segmentLoaderSettings, {
      loaderType: 'vtt',
      featuresNativeTextTracks: _this.tech_.featuresNativeTextTracks,
      loadVttJs: function loadVttJs() {
        return new Promise(function (resolve, reject) {
          function onLoad() {
            tech.off('vttjserror', onError);
            resolve();
          }

          function onError() {
            tech.off('vttjsloaded', onLoad);
            reject();
          }

          tech.one('vttjsloaded', onLoad);
          tech.one('vttjserror', onError); // safe to call multiple times, script will be loaded only once:

          tech.addWebVttScript_();
        });
      }
    }), options);

    var getBandwidth = function getBandwidth() {
      return _this.mainSegmentLoader_.bandwidth;
    };

    _this.contentSteeringController_ = new ContentSteeringController(_this.vhs_.xhr, getBandwidth);

    _this.setupSegmentLoaderListeners_();

    if (_this.bufferBasedABR) {
      _this.mainPlaylistLoader_.one('loadedplaylist', function () {
        return _this.startABRTimer_();
      });

      _this.tech_.on('pause', function () {
        return _this.stopABRTimer_();
      });

      _this.tech_.on('play', function () {
        return _this.startABRTimer_();
      });
    } // Create SegmentLoader stat-getters
    // mediaRequests_
    // mediaRequestsAborted_
    // mediaRequestsTimedout_
    // mediaRequestsErrored_
    // mediaTransferDuration_
    // mediaBytesTransferred_
    // mediaAppends_


    loaderStats.forEach(function (stat) {
      _this[stat + '_'] = sumLoaderStat.bind(_assertThisInitialized(_this), stat);
    });
    _this.logger_ = logger('pc');
    _this.triggeredFmp4Usage = false;

    if (_this.tech_.preload() === 'none') {
      _this.loadOnPlay_ = function () {
        _this.loadOnPlay_ = null;

        _this.mainPlaylistLoader_.load();
      };

      _this.tech_.one('play', _this.loadOnPlay_);
    } else {
      _this.mainPlaylistLoader_.load();
    }

    _this.timeToLoadedData__ = -1;
    _this.mainAppendsToLoadedData__ = -1;
    _this.audioAppendsToLoadedData__ = -1;
    var event = _this.tech_.preload() === 'none' ? 'play' : 'loadstart'; // start the first frame timer on loadstart or play (for preload none)

    _this.tech_.one(event, function () {
      var timeToLoadedDataStart = Date.now();

      _this.tech_.one('loadeddata', function () {
        _this.timeToLoadedData__ = Date.now() - timeToLoadedDataStart;
        _this.mainAppendsToLoadedData__ = _this.mainSegmentLoader_.mediaAppends;
        _this.audioAppendsToLoadedData__ = _this.audioSegmentLoader_.mediaAppends;
      });
    });

    return _this;
  }

  var _proto = PlaylistController.prototype;

  _proto.mainAppendsToLoadedData_ = function mainAppendsToLoadedData_() {
    return this.mainAppendsToLoadedData__;
  };

  _proto.audioAppendsToLoadedData_ = function audioAppendsToLoadedData_() {
    return this.audioAppendsToLoadedData__;
  };

  _proto.appendsToLoadedData_ = function appendsToLoadedData_() {
    var main = this.mainAppendsToLoadedData_();
    var audio = this.audioAppendsToLoadedData_();

    if (main === -1 || audio === -1) {
      return -1;
    }

    return main + audio;
  };

  _proto.timeToLoadedData_ = function timeToLoadedData_() {
    return this.timeToLoadedData__;
  }
  /**
   * Run selectPlaylist and switch to the new playlist if we should
   *
   * @param {string} [reason=abr] a reason for why the ABR check is made
   * @private
   */
  ;

  _proto.checkABR_ = function checkABR_(reason) {
    if (reason === void 0) {
      reason = 'abr';
    }

    var nextPlaylist = this.selectPlaylist();

    if (nextPlaylist && this.shouldSwitchToMedia_(nextPlaylist)) {
      this.switchMedia_(nextPlaylist, reason);
    }
  };

  _proto.switchMedia_ = function switchMedia_(playlist, cause, delay) {
    var oldMedia = this.media();
    var oldId = oldMedia && (oldMedia.id || oldMedia.uri);
    var newId = playlist && (playlist.id || playlist.uri);

    if (oldId && oldId !== newId) {
      this.logger_("switch media " + oldId + " -> " + newId + " from " + cause);
      this.tech_.trigger({
        type: 'usage',
        name: "vhs-rendition-change-" + cause
      });
    }

    this.mainPlaylistLoader_.media(playlist, delay);
  }
  /**
   * A function that ensures we switch our playlists inside of `mediaTypes`
   * to match the current `serviceLocation` provided by the contentSteering controller.
   * We want to check media types of `AUDIO`, `SUBTITLES`, and `CLOSED-CAPTIONS`.
   *
   * This should only be called on a DASH playback scenario while using content steering.
   * This is necessary due to differences in how media in HLS manifests are generally tied to
   * a video playlist, where in DASH that is not always the case.
   */
  ;

  _proto.switchMediaForDASHContentSteering_ = function switchMediaForDASHContentSteering_() {
    var _this2 = this;

    ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function (type) {
      var mediaType = _this2.mediaTypes_[type];
      var activeGroup = mediaType ? mediaType.activeGroup() : null;

      var pathway = _this2.contentSteeringController_.getPathway();

      if (activeGroup && pathway) {
        // activeGroup can be an array or a single group
        var mediaPlaylists = activeGroup.length ? activeGroup[0].playlists : activeGroup.playlists;
        var dashMediaPlaylists = mediaPlaylists.filter(function (p) {
          return p.attributes.serviceLocation === pathway;
        }); // Switch the current active playlist to the correct CDN

        if (dashMediaPlaylists.length) {
          _this2.mediaTypes_[type].activePlaylistLoader.media(dashMediaPlaylists[0]);
        }
      }
    });
  }
  /**
   * Start a timer that periodically calls checkABR_
   *
   * @private
   */
  ;

  _proto.startABRTimer_ = function startABRTimer_() {
    var _this3 = this;

    this.stopABRTimer_();
    this.abrTimer_ = window$1.setInterval(function () {
      return _this3.checkABR_();
    }, 250);
  }
  /**
   * Stop the timer that periodically calls checkABR_
   *
   * @private
   */
  ;

  _proto.stopABRTimer_ = function stopABRTimer_() {
    // if we're scrubbing, we don't need to pause.
    // This getter will be added to Video.js in version 7.11.
    if (this.tech_.scrubbing && this.tech_.scrubbing()) {
      return;
    }

    window$1.clearInterval(this.abrTimer_);
    this.abrTimer_ = null;
  }
  /**
   * Get a list of playlists for the currently selected audio playlist
   *
   * @return {Array} the array of audio playlists
   */
  ;

  _proto.getAudioTrackPlaylists_ = function getAudioTrackPlaylists_() {
    var main = this.main();
    var defaultPlaylists = main && main.playlists || []; // if we don't have any audio groups then we can only
    // assume that the audio tracks are contained in main
    // playlist array, use that or an empty array.

    if (!main || !main.mediaGroups || !main.mediaGroups.AUDIO) {
      return defaultPlaylists;
    }

    var AUDIO = main.mediaGroups.AUDIO;
    var groupKeys = Object.keys(AUDIO);
    var track; // get the current active track

    if (Object.keys(this.mediaTypes_.AUDIO.groups).length) {
      track = this.mediaTypes_.AUDIO.activeTrack(); // or get the default track from main if mediaTypes_ isn't setup yet
    } else {
      // default group is `main` or just the first group.
      var defaultGroup = AUDIO.main || groupKeys.length && AUDIO[groupKeys[0]];

      for (var label in defaultGroup) {
        if (defaultGroup[label].default) {
          track = {
            label: label
          };
          break;
        }
      }
    } // no active track no playlists.


    if (!track) {
      return defaultPlaylists;
    }

    var playlists = []; // get all of the playlists that are possible for the
    // active track.

    for (var group in AUDIO) {
      if (AUDIO[group][track.label]) {
        var properties = AUDIO[group][track.label];

        if (properties.playlists && properties.playlists.length) {
          playlists.push.apply(playlists, properties.playlists);
        } else if (properties.uri) {
          playlists.push(properties);
        } else if (main.playlists.length) {
          // if an audio group does not have a uri
          // see if we have main playlists that use it as a group.
          // if we do then add those to the playlists list.
          for (var i = 0; i < main.playlists.length; i++) {
            var playlist = main.playlists[i];

            if (playlist.attributes && playlist.attributes.AUDIO && playlist.attributes.AUDIO === group) {
              playlists.push(playlist);
            }
          }
        }
      }
    }

    if (!playlists.length) {
      return defaultPlaylists;
    }

    return playlists;
  }
  /**
   * Register event handlers on the main playlist loader. A helper
   * function for construction time.
   *
   * @private
   */
  ;

  _proto.setupMainPlaylistLoaderListeners_ = function setupMainPlaylistLoaderListeners_() {
    var _this4 = this;

    this.mainPlaylistLoader_.on('loadedmetadata', function () {
      var media = _this4.mainPlaylistLoader_.media();

      var requestTimeout = media.targetDuration * 1.5 * 1000; // If we don't have any more available playlists, we don't want to
      // timeout the request.

      if (isLowestEnabledRendition(_this4.mainPlaylistLoader_.main, _this4.mainPlaylistLoader_.media())) {
        _this4.requestOptions_.timeout = 0;
      } else {
        _this4.requestOptions_.timeout = requestTimeout;
      } // if this isn't a live video and preload permits, start
      // downloading segments


      if (media.endList && _this4.tech_.preload() !== 'none') {
        _this4.mainSegmentLoader_.playlist(media, _this4.requestOptions_);

        _this4.mainSegmentLoader_.load();
      }

      setupMediaGroups({
        sourceType: _this4.sourceType_,
        segmentLoaders: {
          AUDIO: _this4.audioSegmentLoader_,
          SUBTITLES: _this4.subtitleSegmentLoader_,
          main: _this4.mainSegmentLoader_
        },
        tech: _this4.tech_,
        requestOptions: _this4.requestOptions_,
        mainPlaylistLoader: _this4.mainPlaylistLoader_,
        vhs: _this4.vhs_,
        main: _this4.main(),
        mediaTypes: _this4.mediaTypes_,
        excludePlaylist: _this4.excludePlaylist.bind(_this4)
      });

      _this4.triggerPresenceUsage_(_this4.main(), media);

      _this4.setupFirstPlay();

      if (!_this4.mediaTypes_.AUDIO.activePlaylistLoader || _this4.mediaTypes_.AUDIO.activePlaylistLoader.media()) {
        _this4.trigger('selectedinitialmedia');
      } else {
        // We must wait for the active audio playlist loader to
        // finish setting up before triggering this event so the
        // representations API and EME setup is correct
        _this4.mediaTypes_.AUDIO.activePlaylistLoader.one('loadedmetadata', function () {
          _this4.trigger('selectedinitialmedia');
        });
      }
    });
    this.mainPlaylistLoader_.on('loadedplaylist', function () {
      if (_this4.loadOnPlay_) {
        _this4.tech_.off('play', _this4.loadOnPlay_);
      }

      var updatedPlaylist = _this4.mainPlaylistLoader_.media();

      if (!updatedPlaylist) {
        // Add content steering listeners on first load and init.
        _this4.attachContentSteeringListeners_();

        _this4.initContentSteeringController_(); // exclude any variants that are not supported by the browser before selecting
        // an initial media as the playlist selectors do not consider browser support


        _this4.excludeUnsupportedVariants_();

        var selectedMedia;

        if (_this4.enableLowInitialPlaylist) {
          selectedMedia = _this4.selectInitialPlaylist();
        }

        if (!selectedMedia) {
          selectedMedia = _this4.selectPlaylist();
        }

        if (!selectedMedia || !_this4.shouldSwitchToMedia_(selectedMedia)) {
          return;
        }

        _this4.initialMedia_ = selectedMedia;

        _this4.switchMedia_(_this4.initialMedia_, 'initial'); // Under the standard case where a source URL is provided, loadedplaylist will
        // fire again since the playlist will be requested. In the case of vhs-json
        // (where the manifest object is provided as the source), when the media
        // playlist's `segments` list is already available, a media playlist won't be
        // requested, and loadedplaylist won't fire again, so the playlist handler must be
        // called on its own here.


        var haveJsonSource = _this4.sourceType_ === 'vhs-json' && _this4.initialMedia_.segments;

        if (!haveJsonSource) {
          return;
        }

        updatedPlaylist = _this4.initialMedia_;
      }

      _this4.handleUpdatedMediaPlaylist(updatedPlaylist);
    });
    this.mainPlaylistLoader_.on('error', function () {
      var error = _this4.mainPlaylistLoader_.error;

      _this4.excludePlaylist({
        playlistToExclude: error.playlist,
        error: error
      });
    });
    this.mainPlaylistLoader_.on('mediachanging', function () {
      _this4.mainSegmentLoader_.abort();

      _this4.mainSegmentLoader_.pause();
    });
    this.mainPlaylistLoader_.on('mediachange', function () {
      var media = _this4.mainPlaylistLoader_.media();

      var requestTimeout = media.targetDuration * 1.5 * 1000; // If we don't have any more available playlists, we don't want to
      // timeout the request.

      if (isLowestEnabledRendition(_this4.mainPlaylistLoader_.main, _this4.mainPlaylistLoader_.media())) {
        _this4.requestOptions_.timeout = 0;
      } else {
        _this4.requestOptions_.timeout = requestTimeout;
      }

      if (_this4.sourceType_ === 'dash') {
        // we don't want to re-request the same hls playlist right after it was changed
        _this4.mainPlaylistLoader_.load();
      } // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `loadedplaylist`


      _this4.mainSegmentLoader_.pause();

      _this4.mainSegmentLoader_.playlist(media, _this4.requestOptions_);

      if (_this4.waitingForFastQualityPlaylistReceived_) {
        _this4.runFastQualitySwitch_();
      } else {
        _this4.mainSegmentLoader_.load();
      }

      _this4.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });
    this.mainPlaylistLoader_.on('playlistunchanged', function () {
      var updatedPlaylist = _this4.mainPlaylistLoader_.media(); // ignore unchanged playlists that have already been
      // excluded for not-changing. We likely just have a really slowly updating
      // playlist.


      if (updatedPlaylist.lastExcludeReason_ === 'playlist-unchanged') {
        return;
      }

      var playlistOutdated = _this4.stuckAtPlaylistEnd_(updatedPlaylist);

      if (playlistOutdated) {
        // Playlist has stopped updating and we're stuck at its end. Try to
        // exclude it and switch to another playlist in the hope that that
        // one is updating (and give the player a chance to re-adjust to the
        // safe live point).
        _this4.excludePlaylist({
          error: {
            message: 'Playlist no longer updating.',
            reason: 'playlist-unchanged'
          }
        }); // useful for monitoring QoS


        _this4.tech_.trigger('playliststuck');
      }
    });
    this.mainPlaylistLoader_.on('renditiondisabled', function () {
      _this4.tech_.trigger({
        type: 'usage',
        name: 'vhs-rendition-disabled'
      });
    });
    this.mainPlaylistLoader_.on('renditionenabled', function () {
      _this4.tech_.trigger({
        type: 'usage',
        name: 'vhs-rendition-enabled'
      });
    });
  }
  /**
   * Given an updated media playlist (whether it was loaded for the first time, or
   * refreshed for live playlists), update any relevant properties and state to reflect
   * changes in the media that should be accounted for (e.g., cues and duration).
   *
   * @param {Object} updatedPlaylist the updated media playlist object
   *
   * @private
   */
  ;

  _proto.handleUpdatedMediaPlaylist = function handleUpdatedMediaPlaylist(updatedPlaylist) {
    if (this.useCueTags_) {
      this.updateAdCues_(updatedPlaylist);
    } // TODO: Create a new event on the PlaylistLoader that signals
    // that the segments have changed in some way and use that to
    // update the SegmentLoader instead of doing it twice here and
    // on `mediachange`


    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);

    if (this.waitingForFastQualityPlaylistReceived_) {
      this.runFastQualitySwitch_();
    }

    this.updateDuration(!updatedPlaylist.endList); // If the player isn't paused, ensure that the segment loader is running,
    // as it is possible that it was temporarily stopped while waiting for
    // a playlist (e.g., in case the playlist errored and we re-requested it).

    if (!this.tech_.paused()) {
      this.mainSegmentLoader_.load();

      if (this.audioSegmentLoader_) {
        this.audioSegmentLoader_.load();
      }
    }
  }
  /**
   * A helper function for triggerring presence usage events once per source
   *
   * @private
   */
  ;

  _proto.triggerPresenceUsage_ = function triggerPresenceUsage_(main, media) {
    var mediaGroups = main.mediaGroups || {};
    var defaultDemuxed = true;
    var audioGroupKeys = Object.keys(mediaGroups.AUDIO);

    for (var mediaGroup in mediaGroups.AUDIO) {
      for (var label in mediaGroups.AUDIO[mediaGroup]) {
        var properties = mediaGroups.AUDIO[mediaGroup][label];

        if (!properties.uri) {
          defaultDemuxed = false;
        }
      }
    }

    if (defaultDemuxed) {
      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-demuxed'
      });
    }

    if (Object.keys(mediaGroups.SUBTITLES).length) {
      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-webvtt'
      });
    }

    if (Vhs$1.Playlist.isAes(media)) {
      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-aes'
      });
    }

    if (audioGroupKeys.length && Object.keys(mediaGroups.AUDIO[audioGroupKeys[0]]).length > 1) {
      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-alternate-audio'
      });
    }

    if (this.useCueTags_) {
      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-playlist-cue-tags'
      });
    }
  };

  _proto.shouldSwitchToMedia_ = function shouldSwitchToMedia_(nextPlaylist) {
    var currentPlaylist = this.mainPlaylistLoader_.media() || this.mainPlaylistLoader_.pendingMedia_;
    var currentTime = this.tech_.currentTime();
    var bufferLowWaterLine = this.bufferLowWaterLine();
    var bufferHighWaterLine = this.bufferHighWaterLine();
    var buffered = this.tech_.buffered();
    return shouldSwitchToMedia({
      buffered: buffered,
      currentTime: currentTime,
      currentPlaylist: currentPlaylist,
      nextPlaylist: nextPlaylist,
      bufferLowWaterLine: bufferLowWaterLine,
      bufferHighWaterLine: bufferHighWaterLine,
      duration: this.duration(),
      bufferBasedABR: this.bufferBasedABR,
      log: this.logger_
    });
  }
  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  ;

  _proto.setupSegmentLoaderListeners_ = function setupSegmentLoaderListeners_() {
    var _this5 = this;

    this.mainSegmentLoader_.on('bandwidthupdate', function () {
      // Whether or not buffer based ABR or another ABR is used, on a bandwidth change it's
      // useful to check to see if a rendition switch should be made.
      _this5.checkABR_('bandwidthupdate');

      _this5.tech_.trigger('bandwidthupdate');
    });
    this.mainSegmentLoader_.on('timeout', function () {
      if (_this5.bufferBasedABR) {
        // If a rendition change is needed, then it would've be done on `bandwidthupdate`.
        // Here the only consideration is that for buffer based ABR there's no guarantee
        // of an immediate switch (since the bandwidth is averaged with a timeout
        // bandwidth value of 1), so force a load on the segment loader to keep it going.
        _this5.mainSegmentLoader_.load();
      }
    }); // `progress` events are not reliable enough of a bandwidth measure to trigger buffer
    // based ABR.

    if (!this.bufferBasedABR) {
      this.mainSegmentLoader_.on('progress', function () {
        _this5.trigger('progress');
      });
    }

    this.mainSegmentLoader_.on('error', function () {
      var error = _this5.mainSegmentLoader_.error();

      _this5.excludePlaylist({
        playlistToExclude: error.playlist,
        error: error
      });
    });
    this.mainSegmentLoader_.on('appenderror', function () {
      _this5.error = _this5.mainSegmentLoader_.error_;

      _this5.trigger('error');
    });
    this.mainSegmentLoader_.on('syncinfoupdate', function () {
      _this5.onSyncInfoUpdate_();
    });
    this.mainSegmentLoader_.on('timestampoffset', function () {
      _this5.tech_.trigger({
        type: 'usage',
        name: 'vhs-timestamp-offset'
      });
    });
    this.audioSegmentLoader_.on('syncinfoupdate', function () {
      _this5.onSyncInfoUpdate_();
    });
    this.audioSegmentLoader_.on('appenderror', function () {
      _this5.error = _this5.audioSegmentLoader_.error_;

      _this5.trigger('error');
    });
    this.mainSegmentLoader_.on('ended', function () {
      _this5.logger_('main segment loader ended');

      _this5.onEndOfStream();
    });
    this.mainSegmentLoader_.on('earlyabort', function (event) {
      // never try to early abort with the new ABR algorithm
      if (_this5.bufferBasedABR) {
        return;
      }

      _this5.delegateLoaders_('all', ['abort']);

      _this5.excludePlaylist({
        error: {
          message: 'Aborted early because there isn\'t enough bandwidth to complete ' + 'the request without rebuffering.'
        },
        playlistExclusionDuration: ABORT_EARLY_EXCLUSION_SECONDS
      });
    });

    var updateCodecs = function updateCodecs() {
      if (!_this5.sourceUpdater_.hasCreatedSourceBuffers()) {
        return _this5.tryToCreateSourceBuffers_();
      }

      var codecs = _this5.getCodecsOrExclude_(); // no codecs means that the playlist was excluded


      if (!codecs) {
        return;
      }

      _this5.sourceUpdater_.addOrChangeSourceBuffers(codecs);
    };

    this.mainSegmentLoader_.on('trackinfo', updateCodecs);
    this.audioSegmentLoader_.on('trackinfo', updateCodecs);
    this.mainSegmentLoader_.on('fmp4', function () {
      if (!_this5.triggeredFmp4Usage) {
        _this5.tech_.trigger({
          type: 'usage',
          name: 'vhs-fmp4'
        });

        _this5.triggeredFmp4Usage = true;
      }
    });
    this.audioSegmentLoader_.on('fmp4', function () {
      if (!_this5.triggeredFmp4Usage) {
        _this5.tech_.trigger({
          type: 'usage',
          name: 'vhs-fmp4'
        });

        _this5.triggeredFmp4Usage = true;
      }
    });
    this.audioSegmentLoader_.on('ended', function () {
      _this5.logger_('audioSegmentLoader ended');

      _this5.onEndOfStream();
    });
  };

  _proto.mediaSecondsLoaded_ = function mediaSecondsLoaded_() {
    return Math.max(this.audioSegmentLoader_.mediaSecondsLoaded + this.mainSegmentLoader_.mediaSecondsLoaded);
  }
  /**
   * Call load on our SegmentLoaders
   */
  ;

  _proto.load = function load() {
    this.mainSegmentLoader_.load();

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.load();
    }

    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.load();
    }
  }
  /**
   * Re-tune playback quality level for the current player
   * conditions. This method will perform destructive actions like removing
   * already buffered content in order to readjust the currently active
   * playlist quickly. This is good for manual quality changes
   *
   * @private
   */
  ;

  _proto.fastQualityChange_ = function fastQualityChange_(media) {
    if (media === void 0) {
      media = this.selectPlaylist();
    }

    if (media && media === this.mainPlaylistLoader_.media()) {
      this.logger_('skipping fastQualityChange because new media is same as old');
      return;
    }

    this.switchMedia_(media, 'fast-quality'); // we would like to avoid race condition when we call fastQuality,
    // reset everything and start loading segments from prev segments instead of new because new playlist is not received yet

    this.waitingForFastQualityPlaylistReceived_ = true;
  };

  _proto.runFastQualitySwitch_ = function runFastQualitySwitch_() {
    var _this6 = this;

    this.waitingForFastQualityPlaylistReceived_ = false; // Delete all buffered data to allow an immediate quality switch, then seek to give
    // the browser a kick to remove any cached frames from the previous rendtion (.04 seconds
    // ahead was roughly the minimum that will accomplish this across a variety of content
    // in IE and Edge, but seeking in place is sufficient on all other browsers)
    // Edge/IE bug: https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/14600375/
    // Chrome bug: https://bugs.chromium.org/p/chromium/issues/detail?id=651904

    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.resetEverything(function () {
      _this6.tech_.setCurrentTime(_this6.tech_.currentTime());
    }); // don't need to reset audio as it is reset when media changes
  }
  /**
   * Begin playback.
   */
  ;

  _proto.play = function play() {
    if (this.setupFirstPlay()) {
      return;
    }

    if (this.tech_.ended()) {
      this.tech_.setCurrentTime(0);
    }

    if (this.hasPlayed_) {
      this.load();
    }

    var seekable = this.tech_.seekable(); // if the viewer has paused and we fell out of the live window,
    // seek forward to the live point

    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < seekable.start(0)) {
        return this.tech_.setCurrentTime(seekable.end(seekable.length - 1));
      }
    }
  }
  /**
   * Seek to the latest media position if this is a live video and the
   * player and video are loaded and initialized.
   */
  ;

  _proto.setupFirstPlay = function setupFirstPlay() {
    var media = this.mainPlaylistLoader_.media(); // Check that everything is ready to begin buffering for the first call to play
    //  If 1) there is no active media
    //     2) the player is paused
    //     3) the first play has already been setup
    // then exit early

    if (!media || this.tech_.paused() || this.hasPlayed_) {
      return false;
    } // when the video is a live stream and/or has a start time


    if (!media.endList || media.start) {
      var seekable = this.seekable();

      if (!seekable.length) {
        // without a seekable range, the player cannot seek to begin buffering at the
        // live or start point
        return false;
      }

      var seekableEnd = seekable.end(0);
      var startPoint = seekableEnd;

      if (media.start) {
        var offset = media.start.timeOffset;

        if (offset < 0) {
          startPoint = Math.max(seekableEnd + offset, seekable.start(0));
        } else {
          startPoint = Math.min(seekableEnd, offset);
        }
      } // trigger firstplay to inform the source handler to ignore the next seek event


      this.trigger('firstplay'); // seek to the live point

      this.tech_.setCurrentTime(startPoint);
    }

    this.hasPlayed_ = true; // we can begin loading now that everything is ready

    this.load();
    return true;
  }
  /**
   * handle the sourceopen event on the MediaSource
   *
   * @private
   */
  ;

  _proto.handleSourceOpen_ = function handleSourceOpen_() {
    // Only attempt to create the source buffer if none already exist.
    // handleSourceOpen is also called when we are "re-opening" a source buffer
    // after `endOfStream` has been called (in response to a seek for instance)
    this.tryToCreateSourceBuffers_(); // if autoplay is enabled, begin playback. This is duplicative of
    // code in video.js but is required because play() must be invoked
    // *after* the media source has opened.

    if (this.tech_.autoplay()) {
      var playPromise = this.tech_.play(); // Catch/silence error when a pause interrupts a play request
      // on browsers which return a promise

      if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
        playPromise.then(null, function (e) {});
      }
    }

    this.trigger('sourceopen');
  }
  /**
   * handle the sourceended event on the MediaSource
   *
   * @private
   */
  ;

  _proto.handleSourceEnded_ = function handleSourceEnded_() {
    if (!this.inbandTextTracks_.metadataTrack_) {
      return;
    }

    var cues = this.inbandTextTracks_.metadataTrack_.cues;

    if (!cues || !cues.length) {
      return;
    }

    var duration = this.duration();
    cues[cues.length - 1].endTime = isNaN(duration) || Math.abs(duration) === Infinity ? Number.MAX_VALUE : duration;
  }
  /**
   * handle the durationchange event on the MediaSource
   *
   * @private
   */
  ;

  _proto.handleDurationChange_ = function handleDurationChange_() {
    this.tech_.trigger('durationchange');
  }
  /**
   * Calls endOfStream on the media source when all active stream types have called
   * endOfStream
   *
   * @param {string} streamType
   *        Stream type of the segment loader that called endOfStream
   * @private
   */
  ;

  _proto.onEndOfStream = function onEndOfStream() {
    var isEndOfStream = this.mainSegmentLoader_.ended_;

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      var mainMediaInfo = this.mainSegmentLoader_.getCurrentMediaInfo_(); // if the audio playlist loader exists, then alternate audio is active

      if (!mainMediaInfo || mainMediaInfo.hasVideo) {
        // if we do not know if the main segment loader contains video yet or if we
        // definitively know the main segment loader contains video, then we need to wait
        // for both main and audio segment loaders to call endOfStream
        isEndOfStream = isEndOfStream && this.audioSegmentLoader_.ended_;
      } else {
        // otherwise just rely on the audio loader
        isEndOfStream = this.audioSegmentLoader_.ended_;
      }
    }

    if (!isEndOfStream) {
      return;
    }

    this.stopABRTimer_();
    this.sourceUpdater_.endOfStream();
  }
  /**
   * Check if a playlist has stopped being updated
   *
   * @param {Object} playlist the media playlist object
   * @return {boolean} whether the playlist has stopped being updated or not
   */
  ;

  _proto.stuckAtPlaylistEnd_ = function stuckAtPlaylistEnd_(playlist) {
    var seekable = this.seekable();

    if (!seekable.length) {
      // playlist doesn't have enough information to determine whether we are stuck
      return false;
    }

    var expired = this.syncController_.getExpiredTime(playlist, this.duration());

    if (expired === null) {
      return false;
    } // does not use the safe live end to calculate playlist end, since we
    // don't want to say we are stuck while there is still content


    var absolutePlaylistEnd = Vhs$1.Playlist.playlistEnd(playlist, expired);
    var currentTime = this.tech_.currentTime();
    var buffered = this.tech_.buffered();

    if (!buffered.length) {
      // return true if the playhead reached the absolute end of the playlist
      return absolutePlaylistEnd - currentTime <= SAFE_TIME_DELTA;
    }

    var bufferedEnd = buffered.end(buffered.length - 1); // return true if there is too little buffer left and buffer has reached absolute
    // end of playlist

    return bufferedEnd - currentTime <= SAFE_TIME_DELTA && absolutePlaylistEnd - bufferedEnd <= SAFE_TIME_DELTA;
  }
  /**
   * Exclude a playlist for a set amount of time, making it unavailable for selection by
   * the rendition selection algorithm, then force a new playlist (rendition) selection.
   *
   * @param {Object=} playlistToExclude
   *                  the playlist to exclude, defaults to the currently selected playlist
   * @param {Object=} error
   *                  an optional error
   * @param {number=} playlistExclusionDuration
   *                  an optional number of seconds to exclude the playlist
   */
  ;

  _proto.excludePlaylist = function excludePlaylist(_ref2) {
    var _this7 = this;

    var _ref2$playlistToExclu = _ref2.playlistToExclude,
        playlistToExclude = _ref2$playlistToExclu === void 0 ? this.mainPlaylistLoader_.media() : _ref2$playlistToExclu,
        _ref2$error = _ref2.error,
        error = _ref2$error === void 0 ? {} : _ref2$error,
        playlistExclusionDuration = _ref2.playlistExclusionDuration;
    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // excluded instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    playlistToExclude = playlistToExclude || this.mainPlaylistLoader_.media();
    playlistExclusionDuration = playlistExclusionDuration || error.playlistExclusionDuration || this.playlistExclusionDuration; // If there is no current playlist, then an error occurred while we were
    // trying to load the main OR while we were disposing of the tech

    if (!playlistToExclude) {
      this.error = error;

      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('network');
      }

      return;
    }

    playlistToExclude.playlistErrors_++;
    var playlists = this.mainPlaylistLoader_.main.playlists;
    var enabledPlaylists = playlists.filter(isEnabled);
    var isFinalRendition = enabledPlaylists.length === 1 && enabledPlaylists[0] === playlistToExclude; // Don't exclude the only playlist unless it was excluded
    // forever

    if (playlists.length === 1 && playlistExclusionDuration !== Infinity) {
      videojs.log.warn("Problem encountered with playlist " + playlistToExclude.id + ". " + 'Trying again since it is the only playlist.');
      this.tech_.trigger('retryplaylist'); // if this is a final rendition, we should delay

      return this.mainPlaylistLoader_.load(isFinalRendition);
    }

    if (isFinalRendition) {
      // If we're content steering, try other pathways.
      if (this.main().contentSteering) {
        var pathway = this.pathwayAttribute_(playlistToExclude); // Ignore at least 1 steering manifest refresh.

        var reIncludeDelay = this.contentSteeringController_.steeringManifest.ttl * 1000;
        this.contentSteeringController_.excludePathway(pathway);
        this.excludeThenChangePathway_();
        setTimeout(function () {
          _this7.contentSteeringController_.addAvailablePathway(pathway);
        }, reIncludeDelay);
        return;
      } // Since we're on the final non-excluded playlist, and we're about to exclude
      // it, instead of erring the player or retrying this playlist, clear out the current
      // exclusion list. This allows other playlists to be attempted in case any have been
      // fixed.


      var reincluded = false;
      playlists.forEach(function (playlist) {
        // skip current playlist which is about to be excluded
        if (playlist === playlistToExclude) {
          return;
        }

        var excludeUntil = playlist.excludeUntil; // a playlist cannot be reincluded if it wasn't excluded to begin with.

        if (typeof excludeUntil !== 'undefined' && excludeUntil !== Infinity) {
          reincluded = true;
          delete playlist.excludeUntil;
        }
      });

      if (reincluded) {
        videojs.log.warn('Removing other playlists from the exclusion list because the last ' + 'rendition is about to be excluded.'); // Technically we are retrying a playlist, in that we are simply retrying a previous
        // playlist. This is needed for users relying on the retryplaylist event to catch a
        // case where the player might be stuck and looping through "dead" playlists.

        this.tech_.trigger('retryplaylist');
      }
    } // Exclude this playlist


    var excludeUntil;

    if (playlistToExclude.playlistErrors_ > this.maxPlaylistRetries) {
      excludeUntil = Infinity;
    } else {
      excludeUntil = Date.now() + playlistExclusionDuration * 1000;
    }

    playlistToExclude.excludeUntil = excludeUntil;

    if (error.reason) {
      playlistToExclude.lastExcludeReason_ = error.reason;
    }

    this.tech_.trigger('excludeplaylist');
    this.tech_.trigger({
      type: 'usage',
      name: 'vhs-rendition-excluded'
    }); // TODO: only load a new playlist if we're excluding the current playlist
    // If this function was called with a playlist that's not the current active playlist
    // (e.g., media().id !== playlistToExclude.id),
    // then a new playlist should not be selected and loaded, as there's nothing wrong with the current playlist.

    var nextPlaylist = this.selectPlaylist();

    if (!nextPlaylist) {
      this.error = 'Playback cannot continue. No available working or supported playlists.';
      this.trigger('error');
      return;
    }

    var logFn = error.internal ? this.logger_ : videojs.log.warn;
    var errorMessage = error.message ? ' ' + error.message : '';
    logFn((error.internal ? 'Internal problem' : 'Problem') + " encountered with playlist " + playlistToExclude.id + "." + (errorMessage + " Switching to playlist " + nextPlaylist.id + ".")); // if audio group changed reset audio loaders

    if (nextPlaylist.attributes.AUDIO !== playlistToExclude.attributes.AUDIO) {
      this.delegateLoaders_('audio', ['abort', 'pause']);
    } // if subtitle group changed reset subtitle loaders


    if (nextPlaylist.attributes.SUBTITLES !== playlistToExclude.attributes.SUBTITLES) {
      this.delegateLoaders_('subtitle', ['abort', 'pause']);
    }

    this.delegateLoaders_('main', ['abort', 'pause']);
    var delayDuration = nextPlaylist.targetDuration / 2 * 1000 || 5 * 1000;
    var shouldDelay = typeof nextPlaylist.lastRequest === 'number' && Date.now() - nextPlaylist.lastRequest <= delayDuration; // delay if it's a final rendition or if the last refresh is sooner than half targetDuration

    return this.switchMedia_(nextPlaylist, 'exclude', isFinalRendition || shouldDelay);
  }
  /**
   * Pause all segment/playlist loaders
   */
  ;

  _proto.pauseLoading = function pauseLoading() {
    this.delegateLoaders_('all', ['abort', 'pause']);
    this.stopABRTimer_();
  }
  /**
   * Call a set of functions in order on playlist loaders, segment loaders,
   * or both types of loaders.
   *
   * @param {string} filter
   *        Filter loaders that should call fnNames using a string. Can be:
   *        * all - run on all loaders
   *        * audio - run on all audio loaders
   *        * subtitle - run on all subtitle loaders
   *        * main - run on the main loaders
   *
   * @param {Array|string} fnNames
   *        A string or array of function names to call.
   */
  ;

  _proto.delegateLoaders_ = function delegateLoaders_(filter, fnNames) {
    var _this8 = this;

    var loaders = [];
    var dontFilterPlaylist = filter === 'all';

    if (dontFilterPlaylist || filter === 'main') {
      loaders.push(this.mainPlaylistLoader_);
    }

    var mediaTypes = [];

    if (dontFilterPlaylist || filter === 'audio') {
      mediaTypes.push('AUDIO');
    }

    if (dontFilterPlaylist || filter === 'subtitle') {
      mediaTypes.push('CLOSED-CAPTIONS');
      mediaTypes.push('SUBTITLES');
    }

    mediaTypes.forEach(function (mediaType) {
      var loader = _this8.mediaTypes_[mediaType] && _this8.mediaTypes_[mediaType].activePlaylistLoader;

      if (loader) {
        loaders.push(loader);
      }
    });
    ['main', 'audio', 'subtitle'].forEach(function (name) {
      var loader = _this8[name + "SegmentLoader_"];

      if (loader && (filter === name || filter === 'all')) {
        loaders.push(loader);
      }
    });
    loaders.forEach(function (loader) {
      return fnNames.forEach(function (fnName) {
        if (typeof loader[fnName] === 'function') {
          loader[fnName]();
        }
      });
    });
  }
  /**
   * set the current time on all segment loaders
   *
   * @param {TimeRange} currentTime the current time to set
   * @return {TimeRange} the current time
   */
  ;

  _proto.setCurrentTime = function setCurrentTime(currentTime) {
    var buffered = findRange(this.tech_.buffered(), currentTime);

    if (!(this.mainPlaylistLoader_ && this.mainPlaylistLoader_.media())) {
      // return immediately if the metadata is not ready yet
      return 0;
    } // it's clearly an edge-case but don't thrown an error if asked to
    // seek within an empty playlist


    if (!this.mainPlaylistLoader_.media().segments) {
      return 0;
    } // if the seek location is already buffered, continue buffering as usual


    if (buffered && buffered.length) {
      return currentTime;
    } // cancel outstanding requests so we begin buffering at the new
    // location


    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.resetEverything();

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
      this.audioSegmentLoader_.resetEverything();
    }

    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
      this.subtitleSegmentLoader_.resetEverything();
    } // start segment loader loading in case they are paused


    this.load();
  }
  /**
   * get the current duration
   *
   * @return {TimeRange} the duration
   */
  ;

  _proto.duration = function duration() {
    if (!this.mainPlaylistLoader_) {
      return 0;
    }

    var media = this.mainPlaylistLoader_.media();

    if (!media) {
      // no playlists loaded yet, so can't determine a duration
      return 0;
    } // Don't rely on the media source for duration in the case of a live playlist since
    // setting the native MediaSource's duration to infinity ends up with consequences to
    // seekable behavior. See https://github.com/w3c/media-source/issues/5 for details.
    //
    // This is resolved in the spec by https://github.com/w3c/media-source/pull/92,
    // however, few browsers have support for setLiveSeekableRange()
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/setLiveSeekableRange
    //
    // Until a time when the duration of the media source can be set to infinity, and a
    // seekable range specified across browsers, just return Infinity.


    if (!media.endList) {
      return Infinity;
    } // Since this is a VOD video, it is safe to rely on the media source's duration (if
    // available). If it's not available, fall back to a playlist-calculated estimate.


    if (this.mediaSource) {
      return this.mediaSource.duration;
    }

    return Vhs$1.Playlist.duration(media);
  }
  /**
   * check the seekable range
   *
   * @return {TimeRange} the seekable range
   */
  ;

  _proto.seekable = function seekable() {
    return this.seekable_;
  };

  _proto.onSyncInfoUpdate_ = function onSyncInfoUpdate_() {
    var audioSeekable; // TODO check for creation of both source buffers before updating seekable
    //
    // A fix was made to this function where a check for
    // this.sourceUpdater_.hasCreatedSourceBuffers
    // was added to ensure that both source buffers were created before seekable was
    // updated. However, it originally had a bug where it was checking for a true and
    // returning early instead of checking for false. Setting it to check for false to
    // return early though created other issues. A call to play() would check for seekable
    // end without verifying that a seekable range was present. In addition, even checking
    // for that didn't solve some issues, as handleFirstPlay is sometimes worked around
    // due to a media update calling load on the segment loaders, skipping a seek to live,
    // thereby starting live streams at the beginning of the stream rather than at the end.
    //
    // This conditional should be fixed to wait for the creation of two source buffers at
    // the same time as the other sections of code are fixed to properly seek to live and
    // not throw an error due to checking for a seekable end when no seekable range exists.
    //
    // For now, fall back to the older behavior, with the understanding that the seekable
    // range may not be completely correct, leading to a suboptimal initial live point.

    if (!this.mainPlaylistLoader_) {
      return;
    }

    var media = this.mainPlaylistLoader_.media();

    if (!media) {
      return;
    }

    var expired = this.syncController_.getExpiredTime(media, this.duration());

    if (expired === null) {
      // not enough information to update seekable
      return;
    }

    var main = this.mainPlaylistLoader_.main;
    var mainSeekable = Vhs$1.Playlist.seekable(media, expired, Vhs$1.Playlist.liveEdgeDelay(main, media));

    if (mainSeekable.length === 0) {
      return;
    }

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      media = this.mediaTypes_.AUDIO.activePlaylistLoader.media();
      expired = this.syncController_.getExpiredTime(media, this.duration());

      if (expired === null) {
        return;
      }

      audioSeekable = Vhs$1.Playlist.seekable(media, expired, Vhs$1.Playlist.liveEdgeDelay(main, media));

      if (audioSeekable.length === 0) {
        return;
      }
    }

    var oldEnd;
    var oldStart;

    if (this.seekable_ && this.seekable_.length) {
      oldEnd = this.seekable_.end(0);
      oldStart = this.seekable_.start(0);
    }

    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      this.seekable_ = mainSeekable;
    } else if (audioSeekable.start(0) > mainSeekable.end(0) || mainSeekable.start(0) > audioSeekable.end(0)) {
      // seekables are pretty far off, rely on main
      this.seekable_ = mainSeekable;
    } else {
      this.seekable_ = createTimeRanges([[audioSeekable.start(0) > mainSeekable.start(0) ? audioSeekable.start(0) : mainSeekable.start(0), audioSeekable.end(0) < mainSeekable.end(0) ? audioSeekable.end(0) : mainSeekable.end(0)]]);
    } // seekable is the same as last time


    if (this.seekable_ && this.seekable_.length) {
      if (this.seekable_.end(0) === oldEnd && this.seekable_.start(0) === oldStart) {
        return;
      }
    }

    this.logger_("seekable updated [" + printableRange(this.seekable_) + "]");
    this.tech_.trigger('seekablechanged');
  }
  /**
   * Update the player duration
   */
  ;

  _proto.updateDuration = function updateDuration(isLive) {
    if (this.updateDuration_) {
      this.mediaSource.removeEventListener('sourceopen', this.updateDuration_);
      this.updateDuration_ = null;
    }

    if (this.mediaSource.readyState !== 'open') {
      this.updateDuration_ = this.updateDuration.bind(this, isLive);
      this.mediaSource.addEventListener('sourceopen', this.updateDuration_);
      return;
    }

    if (isLive) {
      var seekable = this.seekable();

      if (!seekable.length) {
        return;
      } // Even in the case of a live playlist, the native MediaSource's duration should not
      // be set to Infinity (even though this would be expected for a live playlist), since
      // setting the native MediaSource's duration to infinity ends up with consequences to
      // seekable behavior. See https://github.com/w3c/media-source/issues/5 for details.
      //
      // This is resolved in the spec by https://github.com/w3c/media-source/pull/92,
      // however, few browsers have support for setLiveSeekableRange()
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/setLiveSeekableRange
      //
      // Until a time when the duration of the media source can be set to infinity, and a
      // seekable range specified across browsers, the duration should be greater than or
      // equal to the last possible seekable value.
      // MediaSource duration starts as NaN
      // It is possible (and probable) that this case will never be reached for many
      // sources, since the MediaSource reports duration as the highest value without
      // accounting for timestamp offset. For example, if the timestamp offset is -100 and
      // we buffered times 0 to 100 with real times of 100 to 200, even though current
      // time will be between 0 and 100, the native media source may report the duration
      // as 200. However, since we report duration separate from the media source (as
      // Infinity), and as long as the native media source duration value is greater than
      // our reported seekable range, seeks will work as expected. The large number as
      // duration for live is actually a strategy used by some players to work around the
      // issue of live seekable ranges cited above.


      if (isNaN(this.mediaSource.duration) || this.mediaSource.duration < seekable.end(seekable.length - 1)) {
        this.sourceUpdater_.setDuration(seekable.end(seekable.length - 1));
      }

      return;
    }

    var buffered = this.tech_.buffered();
    var duration = Vhs$1.Playlist.duration(this.mainPlaylistLoader_.media());

    if (buffered.length > 0) {
      duration = Math.max(duration, buffered.end(buffered.length - 1));
    }

    if (this.mediaSource.duration !== duration) {
      this.sourceUpdater_.setDuration(duration);
    }
  }
  /**
   * dispose of the PlaylistController and everything
   * that it controls
   */
  ;

  _proto.dispose = function dispose() {
    var _this9 = this;

    this.trigger('dispose');
    this.decrypter_.terminate();
    this.mainPlaylistLoader_.dispose();
    this.mainSegmentLoader_.dispose();
    this.contentSteeringController_.dispose();
    this.keyStatusMap_.clear();

    if (this.loadOnPlay_) {
      this.tech_.off('play', this.loadOnPlay_);
    }

    ['AUDIO', 'SUBTITLES'].forEach(function (type) {
      var groups = _this9.mediaTypes_[type].groups;

      for (var id in groups) {
        groups[id].forEach(function (group) {
          if (group.playlistLoader) {
            group.playlistLoader.dispose();
          }
        });
      }
    });
    this.audioSegmentLoader_.dispose();
    this.subtitleSegmentLoader_.dispose();
    this.sourceUpdater_.dispose();
    this.timelineChangeController_.dispose();
    this.stopABRTimer_();

    if (this.updateDuration_) {
      this.mediaSource.removeEventListener('sourceopen', this.updateDuration_);
    }

    this.mediaSource.removeEventListener('durationchange', this.handleDurationChange_); // load the media source into the player

    this.mediaSource.removeEventListener('sourceopen', this.handleSourceOpen_);
    this.mediaSource.removeEventListener('sourceended', this.handleSourceEnded_);
    this.off();
  }
  /**
   * return the main playlist object if we have one
   *
   * @return {Object} the main playlist object that we parsed
   */
  ;

  _proto.main = function main() {
    return this.mainPlaylistLoader_.main;
  }
  /**
   * return the currently selected playlist
   *
   * @return {Object} the currently selected playlist object that we parsed
   */
  ;

  _proto.media = function media() {
    // playlist loader will not return media if it has not been fully loaded
    return this.mainPlaylistLoader_.media() || this.initialMedia_;
  };

  _proto.areMediaTypesKnown_ = function areMediaTypesKnown_() {
    var usingAudioLoader = !!this.mediaTypes_.AUDIO.activePlaylistLoader;
    var hasMainMediaInfo = !!this.mainSegmentLoader_.getCurrentMediaInfo_(); // if we are not using an audio loader, then we have audio media info
    // otherwise check on the segment loader.

    var hasAudioMediaInfo = !usingAudioLoader ? true : !!this.audioSegmentLoader_.getCurrentMediaInfo_(); // one or both loaders has not loaded sufficently to get codecs

    if (!hasMainMediaInfo || !hasAudioMediaInfo) {
      return false;
    }

    return true;
  };

  _proto.getCodecsOrExclude_ = function getCodecsOrExclude_() {
    var _this10 = this;

    var media = {
      main: this.mainSegmentLoader_.getCurrentMediaInfo_() || {},
      audio: this.audioSegmentLoader_.getCurrentMediaInfo_() || {}
    };
    var playlist = this.mainSegmentLoader_.getPendingSegmentPlaylist() || this.media(); // set "main" media equal to video

    media.video = media.main;
    var playlistCodecs = codecsForPlaylist(this.main(), playlist);
    var codecs = {};
    var usingAudioLoader = !!this.mediaTypes_.AUDIO.activePlaylistLoader;

    if (media.main.hasVideo) {
      codecs.video = playlistCodecs.video || media.main.videoCodec || DEFAULT_VIDEO_CODEC;
    }

    if (media.main.isMuxed) {
      codecs.video += "," + (playlistCodecs.audio || media.main.audioCodec || DEFAULT_AUDIO_CODEC);
    }

    if (media.main.hasAudio && !media.main.isMuxed || media.audio.hasAudio || usingAudioLoader) {
      codecs.audio = playlistCodecs.audio || media.main.audioCodec || media.audio.audioCodec || DEFAULT_AUDIO_CODEC; // set audio isFmp4 so we use the correct "supports" function below

      media.audio.isFmp4 = media.main.hasAudio && !media.main.isMuxed ? media.main.isFmp4 : media.audio.isFmp4;
    } // no codecs, no playback.


    if (!codecs.audio && !codecs.video) {
      this.excludePlaylist({
        playlistToExclude: playlist,
        error: {
          message: 'Could not determine codecs for playlist.'
        },
        playlistExclusionDuration: Infinity
      });
      return;
    } // fmp4 relies on browser support, while ts relies on muxer support


    var supportFunction = function supportFunction(isFmp4, codec) {
      return isFmp4 ? browserSupportsCodec(codec) : muxerSupportsCodec(codec);
    };

    var unsupportedCodecs = {};
    var unsupportedAudio;
    ['video', 'audio'].forEach(function (type) {
      if (codecs.hasOwnProperty(type) && !supportFunction(media[type].isFmp4, codecs[type])) {
        var supporter = media[type].isFmp4 ? 'browser' : 'muxer';
        unsupportedCodecs[supporter] = unsupportedCodecs[supporter] || [];
        unsupportedCodecs[supporter].push(codecs[type]);

        if (type === 'audio') {
          unsupportedAudio = supporter;
        }
      }
    });

    if (usingAudioLoader && unsupportedAudio && playlist.attributes.AUDIO) {
      var audioGroup = playlist.attributes.AUDIO;
      this.main().playlists.forEach(function (variant) {
        var variantAudioGroup = variant.attributes && variant.attributes.AUDIO;

        if (variantAudioGroup === audioGroup && variant !== playlist) {
          variant.excludeUntil = Infinity;
        }
      });
      this.logger_("excluding audio group " + audioGroup + " as " + unsupportedAudio + " does not support codec(s): \"" + codecs.audio + "\"");
    } // if we have any unsupported codecs exclude this playlist.


    if (Object.keys(unsupportedCodecs).length) {
      var message = Object.keys(unsupportedCodecs).reduce(function (acc, supporter) {
        if (acc) {
          acc += ', ';
        }

        acc += supporter + " does not support codec(s): \"" + unsupportedCodecs[supporter].join(',') + "\"";
        return acc;
      }, '') + '.';
      this.excludePlaylist({
        playlistToExclude: playlist,
        error: {
          internal: true,
          message: message
        },
        playlistExclusionDuration: Infinity
      });
      return;
    } // check if codec switching is happening


    if (this.sourceUpdater_.hasCreatedSourceBuffers() && !this.sourceUpdater_.canChangeType()) {
      var switchMessages = [];
      ['video', 'audio'].forEach(function (type) {
        var newCodec = (parseCodecs(_this10.sourceUpdater_.codecs[type] || '')[0] || {}).type;
        var oldCodec = (parseCodecs(codecs[type] || '')[0] || {}).type;

        if (newCodec && oldCodec && newCodec.toLowerCase() !== oldCodec.toLowerCase()) {
          switchMessages.push("\"" + _this10.sourceUpdater_.codecs[type] + "\" -> \"" + codecs[type] + "\"");
        }
      });

      if (switchMessages.length) {
        this.excludePlaylist({
          playlistToExclude: playlist,
          error: {
            message: "Codec switching not supported: " + switchMessages.join(', ') + ".",
            internal: true
          },
          playlistExclusionDuration: Infinity
        });
        return;
      }
    } // TODO: when using the muxer shouldn't we just return
    // the codecs that the muxer outputs?


    return codecs;
  }
  /**
   * Create source buffers and exlude any incompatible renditions.
   *
   * @private
   */
  ;

  _proto.tryToCreateSourceBuffers_ = function tryToCreateSourceBuffers_() {
    // media source is not ready yet or sourceBuffers are already
    // created.
    if (this.mediaSource.readyState !== 'open' || this.sourceUpdater_.hasCreatedSourceBuffers()) {
      return;
    }

    if (!this.areMediaTypesKnown_()) {
      return;
    }

    var codecs = this.getCodecsOrExclude_(); // no codecs means that the playlist was excluded

    if (!codecs) {
      return;
    }

    this.sourceUpdater_.createSourceBuffers(codecs);
    var codecString = [codecs.video, codecs.audio].filter(Boolean).join(',');
    this.excludeIncompatibleVariants_(codecString);
  }
  /**
   * Excludes playlists with codecs that are unsupported by the muxer and browser.
   */
  ;

  _proto.excludeUnsupportedVariants_ = function excludeUnsupportedVariants_() {
    var _this11 = this;

    var playlists = this.main().playlists;
    var ids = []; // TODO: why don't we have a property to loop through all
    // playlist? Why did we ever mix indexes and keys?

    Object.keys(playlists).forEach(function (key) {
      var variant = playlists[key]; // check if we already processed this playlist.

      if (ids.indexOf(variant.id) !== -1) {
        return;
      }

      ids.push(variant.id);
      var codecs = codecsForPlaylist(_this11.main, variant);
      var unsupported = [];

      if (codecs.audio && !muxerSupportsCodec(codecs.audio) && !browserSupportsCodec(codecs.audio)) {
        unsupported.push("audio codec " + codecs.audio);
      }

      if (codecs.video && !muxerSupportsCodec(codecs.video) && !browserSupportsCodec(codecs.video)) {
        unsupported.push("video codec " + codecs.video);
      }

      if (codecs.text && codecs.text === 'stpp.ttml.im1t') {
        unsupported.push("text codec " + codecs.text);
      }

      if (unsupported.length) {
        variant.excludeUntil = Infinity;

        _this11.logger_("excluding " + variant.id + " for unsupported: " + unsupported.join(', '));
      }
    });
  }
  /**
   * Exclude playlists that are known to be codec or
   * stream-incompatible with the SourceBuffer configuration. For
   * instance, Media Source Extensions would cause the video element to
   * stall waiting for video data if you switched from a variant with
   * video and audio to an audio-only one.
   *
   * @param {Object} media a media playlist compatible with the current
   * set of SourceBuffers. Variants in the current main playlist that
   * do not appear to have compatible codec or stream configurations
   * will be excluded from the default playlist selection algorithm
   * indefinitely.
   * @private
   */
  ;

  _proto.excludeIncompatibleVariants_ = function excludeIncompatibleVariants_(codecString) {
    var _this12 = this;

    var ids = [];
    var playlists = this.main().playlists;
    var codecs = unwrapCodecList(parseCodecs(codecString));
    var codecCount_ = codecCount(codecs);
    var videoDetails = codecs.video && parseCodecs(codecs.video)[0] || null;
    var audioDetails = codecs.audio && parseCodecs(codecs.audio)[0] || null;
    Object.keys(playlists).forEach(function (key) {
      var variant = playlists[key]; // check if we already processed this playlist.
      // or it if it is already excluded forever.

      if (ids.indexOf(variant.id) !== -1 || variant.excludeUntil === Infinity) {
        return;
      }

      ids.push(variant.id);
      var exclusionReasons = []; // get codecs from the playlist for this variant

      var variantCodecs = codecsForPlaylist(_this12.mainPlaylistLoader_.main, variant);
      var variantCodecCount = codecCount(variantCodecs); // if no codecs are listed, we cannot determine that this
      // variant is incompatible. Wait for mux.js to probe

      if (!variantCodecs.audio && !variantCodecs.video) {
        return;
      } // TODO: we can support this by removing the
      // old media source and creating a new one, but it will take some work.
      // The number of streams cannot change


      if (variantCodecCount !== codecCount_) {
        exclusionReasons.push("codec count \"" + variantCodecCount + "\" !== \"" + codecCount_ + "\"");
      } // only exclude playlists by codec change, if codecs cannot switch
      // during playback.


      if (!_this12.sourceUpdater_.canChangeType()) {
        var variantVideoDetails = variantCodecs.video && parseCodecs(variantCodecs.video)[0] || null;
        var variantAudioDetails = variantCodecs.audio && parseCodecs(variantCodecs.audio)[0] || null; // the video codec cannot change

        if (variantVideoDetails && videoDetails && variantVideoDetails.type.toLowerCase() !== videoDetails.type.toLowerCase()) {
          exclusionReasons.push("video codec \"" + variantVideoDetails.type + "\" !== \"" + videoDetails.type + "\"");
        } // the audio codec cannot change


        if (variantAudioDetails && audioDetails && variantAudioDetails.type.toLowerCase() !== audioDetails.type.toLowerCase()) {
          exclusionReasons.push("audio codec \"" + variantAudioDetails.type + "\" !== \"" + audioDetails.type + "\"");
        }
      }

      if (exclusionReasons.length) {
        variant.excludeUntil = Infinity;

        _this12.logger_("excluding " + variant.id + ": " + exclusionReasons.join(' && '));
      }
    });
  };

  _proto.updateAdCues_ = function updateAdCues_(media) {
    var offset = 0;
    var seekable = this.seekable();

    if (seekable.length) {
      offset = seekable.start(0);
    }

    updateAdCues(media, this.cueTagsTrack_, offset);
  }
  /**
   * Calculates the desired forward buffer length based on current time
   *
   * @return {number} Desired forward buffer length in seconds
   */
  ;

  _proto.goalBufferLength = function goalBufferLength() {
    var currentTime = this.tech_.currentTime();
    var initial = Config.GOAL_BUFFER_LENGTH;
    var rate = Config.GOAL_BUFFER_LENGTH_RATE;
    var max = Math.max(initial, Config.MAX_GOAL_BUFFER_LENGTH);
    return Math.min(initial + currentTime * rate, max);
  }
  /**
   * Calculates the desired buffer low water line based on current time
   *
   * @return {number} Desired buffer low water line in seconds
   */
  ;

  _proto.bufferLowWaterLine = function bufferLowWaterLine() {
    var currentTime = this.tech_.currentTime();
    var initial = Config.BUFFER_LOW_WATER_LINE;
    var rate = Config.BUFFER_LOW_WATER_LINE_RATE;
    var max = Math.max(initial, Config.MAX_BUFFER_LOW_WATER_LINE);
    var newMax = Math.max(initial, Config.EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE);
    return Math.min(initial + currentTime * rate, this.bufferBasedABR ? newMax : max);
  };

  _proto.bufferHighWaterLine = function bufferHighWaterLine() {
    return Config.BUFFER_HIGH_WATER_LINE;
  };

  _proto.addDateRangesToTextTrack_ = function addDateRangesToTextTrack_(dateRanges) {
    createMetadataTrackIfNotExists(this.inbandTextTracks_, 'com.apple.streaming', this.tech_);
    addDateRangeMetadata({
      inbandTextTracks: this.inbandTextTracks_,
      dateRanges: dateRanges
    });
  };

  _proto.addMetadataToTextTrack = function addMetadataToTextTrack(dispatchType, metadataArray, videoDuration) {
    var timestampOffset = this.sourceUpdater_.videoBuffer ? this.sourceUpdater_.videoTimestampOffset() : this.sourceUpdater_.audioTimestampOffset(); // There's potentially an issue where we could double add metadata if there's a muxed
    // audio/video source with a metadata track, and an alt audio with a metadata track.
    // However, this probably won't happen, and if it does it can be handled then.

    createMetadataTrackIfNotExists(this.inbandTextTracks_, dispatchType, this.tech_);
    addMetadata({
      inbandTextTracks: this.inbandTextTracks_,
      metadataArray: metadataArray,
      timestampOffset: timestampOffset,
      videoDuration: videoDuration
    });
  }
  /**
   * Utility for getting the pathway or service location from an HLS or DASH playlist.
   *
   * @param {Object} playlist for getting pathway from.
   * @return the pathway attribute of a playlist
   */
  ;

  _proto.pathwayAttribute_ = function pathwayAttribute_(playlist) {
    return playlist.attributes['PATHWAY-ID'] || playlist.attributes.serviceLocation;
  }
  /**
   * Initialize available pathways and apply the tag properties.
   */
  ;

  _proto.initContentSteeringController_ = function initContentSteeringController_() {
    var _this13 = this;

    var main = this.main();

    if (!main.contentSteering) {
      return;
    }

    for (var _iterator = _createForOfIteratorHelperLoose(main.playlists), _step; !(_step = _iterator()).done;) {
      var playlist = _step.value;
      this.contentSteeringController_.addAvailablePathway(this.pathwayAttribute_(playlist));
    }

    this.contentSteeringController_.assignTagProperties(main.uri, main.contentSteering); // request the steering manifest immediately if queryBeforeStart is set.

    if (this.contentSteeringController_.queryBeforeStart) {
      // When queryBeforeStart is true, initial request should omit steering parameters.
      this.contentSteeringController_.requestSteeringManifest(true);
      return;
    } // otherwise start content steering after playback starts


    this.tech_.one('canplay', function () {
      _this13.contentSteeringController_.requestSteeringManifest();
    });
  }
  /**
   * Reset the content steering controller and re-init.
   */
  ;

  _proto.resetContentSteeringController_ = function resetContentSteeringController_() {
    this.contentSteeringController_.clearAvailablePathways();
    this.contentSteeringController_.dispose();
    this.initContentSteeringController_();
  }
  /**
   * Attaches the listeners for content steering.
   */
  ;

  _proto.attachContentSteeringListeners_ = function attachContentSteeringListeners_() {
    var _this14 = this;

    this.contentSteeringController_.on('content-steering', this.excludeThenChangePathway_.bind(this));

    if (this.sourceType_ === 'dash') {
      this.mainPlaylistLoader_.on('loadedplaylist', function () {
        var main = _this14.main(); // check if steering tag or pathways changed.


        var didDashTagChange = _this14.contentSteeringController_.didDASHTagChange(main.uri, main.contentSteering);

        var didPathwaysChange = function didPathwaysChange() {
          var availablePathways = _this14.contentSteeringController_.getAvailablePathways();

          var newPathways = [];

          for (var _iterator2 = _createForOfIteratorHelperLoose(main.playlists), _step2; !(_step2 = _iterator2()).done;) {
            var playlist = _step2.value;
            var serviceLocation = playlist.attributes.serviceLocation;

            if (serviceLocation) {
              newPathways.push(serviceLocation);

              if (!availablePathways.has(serviceLocation)) {
                return true;
              }
            }
          } // If we have no new serviceLocations and previously had availablePathways


          if (!newPathways.length && availablePathways.size) {
            return true;
          }

          return false;
        };

        if (didDashTagChange || didPathwaysChange()) {
          _this14.resetContentSteeringController_();
        }
      });
    }
  }
  /**
   * Simple exclude and change playlist logic for content steering.
   */
  ;

  _proto.excludeThenChangePathway_ = function excludeThenChangePathway_() {
    var _this15 = this;

    var currentPathway = this.contentSteeringController_.getPathway();

    if (!currentPathway) {
      return;
    }

    this.handlePathwayClones_();
    var main = this.main();
    var playlists = main.playlists;
    var ids = new Set();
    var didEnablePlaylists = false;
    Object.keys(playlists).forEach(function (key) {
      var variant = playlists[key];

      var pathwayId = _this15.pathwayAttribute_(variant);

      var differentPathwayId = pathwayId && currentPathway !== pathwayId;
      var steeringExclusion = variant.excludeUntil === Infinity && variant.lastExcludeReason_ === 'content-steering';

      if (steeringExclusion && !differentPathwayId) {
        delete variant.excludeUntil;
        delete variant.lastExcludeReason_;
        didEnablePlaylists = true;
      }

      var noExcludeUntil = !variant.excludeUntil && variant.excludeUntil !== Infinity;
      var shouldExclude = !ids.has(variant.id) && differentPathwayId && noExcludeUntil;

      if (!shouldExclude) {
        return;
      }

      ids.add(variant.id);
      variant.excludeUntil = Infinity;
      variant.lastExcludeReason_ = 'content-steering'; // TODO: kind of spammy, maybe move this.

      _this15.logger_("excluding " + variant.id + " for " + variant.lastExcludeReason_);
    });

    if (this.contentSteeringController_.manifestType_ === 'DASH') {
      Object.keys(this.mediaTypes_).forEach(function (key) {
        var type = _this15.mediaTypes_[key];

        if (type.activePlaylistLoader) {
          var currentPlaylist = type.activePlaylistLoader.media_; // Check if the current media playlist matches the current CDN

          if (currentPlaylist && currentPlaylist.attributes.serviceLocation !== currentPathway) {
            didEnablePlaylists = true;
          }
        }
      });
    }

    if (didEnablePlaylists) {
      this.changeSegmentPathway_();
    }
  }
  /**
   * Add, update, or delete playlists and media groups for
   * the pathway clones for HLS Content Steering.
   *
   * See https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/
   *
   * NOTE: Pathway cloning does not currently support the `PER_VARIANT_URIS` and
   * `PER_RENDITION_URIS` as we do not handle `STABLE-VARIANT-ID` or
   * `STABLE-RENDITION-ID` values.
   */
  ;

  _proto.handlePathwayClones_ = function handlePathwayClones_() {
    var _this16 = this;

    var main = this.main();
    var playlists = main.playlists;
    var currentPathwayClones = this.contentSteeringController_.currentPathwayClones;
    var nextPathwayClones = this.contentSteeringController_.nextPathwayClones;
    var hasClones = currentPathwayClones && currentPathwayClones.size || nextPathwayClones && nextPathwayClones.size;

    if (!hasClones) {
      return;
    }

    for (var _iterator3 = _createForOfIteratorHelperLoose(currentPathwayClones.entries()), _step3; !(_step3 = _iterator3()).done;) {
      var _step3$value = _step3.value,
          id = _step3$value[0],
          clone = _step3$value[1];
      var newClone = nextPathwayClones.get(id); // Delete the old pathway clone.

      if (!newClone) {
        this.mainPlaylistLoader_.updateOrDeleteClone(clone);
        this.contentSteeringController_.excludePathway(id);
      }
    }

    var _loop = function _loop() {
      var _step4$value = _step4.value,
          id = _step4$value[0],
          clone = _step4$value[1];
      var oldClone = currentPathwayClones.get(id); // Create a new pathway if it is a new pathway clone object.

      if (!oldClone) {
        var playlistsToClone = playlists.filter(function (p) {
          return p.attributes['PATHWAY-ID'] === clone['BASE-ID'];
        });
        playlistsToClone.forEach(function (p) {
          _this16.mainPlaylistLoader_.addClonePathway(clone, p);
        });

        _this16.contentSteeringController_.addAvailablePathway(id);

        return "continue";
      } // There have not been changes to the pathway clone object, so skip.


      if (_this16.equalPathwayClones_(oldClone, clone)) {
        return "continue";
      } // Update a preexisting cloned pathway.
      // True is set for the update flag.


      _this16.mainPlaylistLoader_.updateOrDeleteClone(clone, true);

      _this16.contentSteeringController_.addAvailablePathway(id);
    };

    for (var _iterator4 = _createForOfIteratorHelperLoose(nextPathwayClones.entries()), _step4; !(_step4 = _iterator4()).done;) {
      var _ret = _loop();

      if (_ret === "continue") continue;
    } // Deep copy contents of next to current pathways.


    this.contentSteeringController_.currentPathwayClones = new Map(JSON.parse(JSON.stringify([].concat(nextPathwayClones))));
  }
  /**
   * Determines whether two pathway clone objects are equivalent.
   *
   * @param {Object} a The first pathway clone object.
   * @param {Object} b The second pathway clone object.
   * @return {boolean} True if the pathway clone objects are equal, false otherwise.
   */
  ;

  _proto.equalPathwayClones_ = function equalPathwayClones_(a, b) {
    if (a['BASE-ID'] !== b['BASE-ID'] || a.ID !== b.ID || a['URI-REPLACEMENT'].HOST !== b['URI-REPLACEMENT'].HOST) {
      return false;
    }

    var aParams = a['URI-REPLACEMENT'].PARAMS;
    var bParams = b['URI-REPLACEMENT'].PARAMS; // We need to iterate through both lists of params because one could be
    // missing a parameter that the other has.

    for (var p in aParams) {
      if (aParams[p] !== bParams[p]) {
        return false;
      }
    }

    for (var _p in bParams) {
      if (aParams[_p] !== bParams[_p]) {
        return false;
      }
    }

    return true;
  }
  /**
   * Changes the current playlists for audio, video and subtitles after a new pathway
   * is chosen from content steering.
   */
  ;

  _proto.changeSegmentPathway_ = function changeSegmentPathway_() {
    var nextPlaylist = this.selectPlaylist();
    this.pauseLoading(); // Switch audio and text track playlists if necessary in DASH

    if (this.contentSteeringController_.manifestType_ === 'DASH') {
      this.switchMediaForDASHContentSteering_();
    }

    this.switchMedia_(nextPlaylist, 'content-steering');
  }
  /**
   * Iterates through playlists and check their keyId set and compare with the
   * keyStatusMap, only enable playlists that have a usable key. If the playlist
   * has no keyId leave it enabled by default.
   */
  ;

  _proto.excludeNonUsablePlaylistsByKeyId_ = function excludeNonUsablePlaylistsByKeyId_() {
    var _this17 = this;

    if (!this.mainPlaylistLoader_ || !this.mainPlaylistLoader_.main) {
      return;
    }

    var nonUsableKeyStatusCount = 0;
    var NON_USABLE = 'non-usable';
    this.mainPlaylistLoader_.main.playlists.forEach(function (playlist) {
      var keyIdSet = _this17.mainPlaylistLoader_.getKeyIdSet(playlist); // If the playlist doesn't have keyIDs lets not exclude it.


      if (!keyIdSet || !keyIdSet.size) {
        return;
      }

      keyIdSet.forEach(function (key) {
        var USABLE = 'usable';
        var hasUsableKeyStatus = _this17.keyStatusMap_.has(key) && _this17.keyStatusMap_.get(key) === USABLE;
        var nonUsableExclusion = playlist.lastExcludeReason_ === NON_USABLE && playlist.excludeUntil === Infinity;

        if (!hasUsableKeyStatus) {
          // Only exclude playlists that haven't already been excluded as non-usable.
          if (playlist.excludeUntil !== Infinity && playlist.lastExcludeReason_ !== NON_USABLE) {
            playlist.excludeUntil = Infinity;
            playlist.lastExcludeReason_ = NON_USABLE;

            _this17.logger_("excluding playlist " + playlist.id + " because the key ID " + key + " doesn't exist in the keyStatusMap or is not " + USABLE);
          } // count all nonUsableKeyStatus


          nonUsableKeyStatusCount++;
        } else if (hasUsableKeyStatus && nonUsableExclusion) {
          delete playlist.excludeUntil;
          delete playlist.lastExcludeReason_;

          _this17.logger_("enabling playlist " + playlist.id + " because key ID " + key + " is " + USABLE);
        }
      });
    }); // If for whatever reason every playlist has a non usable key status. Lets try re-including the SD renditions as a failsafe.

    if (nonUsableKeyStatusCount >= this.mainPlaylistLoader_.main.playlists.length) {
      this.mainPlaylistLoader_.main.playlists.forEach(function (playlist) {
        var isNonHD = playlist && playlist.attributes && playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.height < 720;
        var excludedForNonUsableKey = playlist.excludeUntil === Infinity && playlist.lastExcludeReason_ === NON_USABLE;

        if (isNonHD && excludedForNonUsableKey) {
          // Only delete the excludeUntil so we don't try and re-exclude these playlists.
          delete playlist.excludeUntil;
          videojs.log.warn("enabling non-HD playlist " + playlist.id + " because all playlists were excluded due to " + NON_USABLE + " key IDs");
        }
      });
    }
  }
  /**
   * Adds a keystatus to the keystatus map, tries to convert to string if necessary.
   *
   * @param {any} keyId the keyId to add a status for
   * @param {string} status the status of the keyId
   */
  ;

  _proto.addKeyStatus_ = function addKeyStatus_(keyId, status) {
    var isString = typeof keyId === 'string';
    var keyIdHexString = isString ? keyId : bufferToHexString(keyId);
    var formattedKeyIdString = keyIdHexString.slice(0, 32).toLowerCase();
    this.logger_("KeyStatus '" + status + "' with key ID " + formattedKeyIdString + " added to the keyStatusMap");
    this.keyStatusMap_.set(formattedKeyIdString, status);
  }
  /**
   * Utility function for adding key status to the keyStatusMap and filtering usable encrypted playlists.
   *
   * @param {any} keyId the keyId from the keystatuschange event
   * @param {string} status the key status string
   */
  ;

  _proto.updatePlaylistByKeyStatus = function updatePlaylistByKeyStatus(keyId, status) {
    this.addKeyStatus_(keyId, status);

    if (!this.waitingForFastQualityPlaylistReceived_) {
      this.excludeNonUsableThenChangePlaylist_();
    } // Listen to loadedplaylist with a single listener and check for new contentProtection elements when a playlist is updated.


    this.mainPlaylistLoader_.off('loadedplaylist', this.excludeNonUsableThenChangePlaylist_.bind(this));
    this.mainPlaylistLoader_.on('loadedplaylist', this.excludeNonUsableThenChangePlaylist_.bind(this));
  };

  _proto.excludeNonUsableThenChangePlaylist_ = function excludeNonUsableThenChangePlaylist_() {
    this.excludeNonUsablePlaylistsByKeyId_();
    this.fastQualityChange_();
  };

  return PlaylistController;
}(videojs.EventTarget);

/**
 * Returns a function that acts as the Enable/disable playlist function.
 *
 * @param {PlaylistLoader} loader - The main playlist loader
 * @param {string} playlistID - id of the playlist
 * @param {Function} changePlaylistFn - A function to be called after a
 * playlist's enabled-state has been changed. Will NOT be called if a
 * playlist's enabled-state is unchanged
 * @param {boolean=} enable - Value to set the playlist enabled-state to
 * or if undefined returns the current enabled-state for the playlist
 * @return {Function} Function for setting/getting enabled
 */

var enableFunction = function enableFunction(loader, playlistID, changePlaylistFn) {
  return function (enable) {
    var playlist = loader.main.playlists[playlistID];
    var incompatible = isIncompatible(playlist);
    var currentlyEnabled = isEnabled(playlist);

    if (typeof enable === 'undefined') {
      return currentlyEnabled;
    }

    if (enable) {
      delete playlist.disabled;
    } else {
      playlist.disabled = true;
    }

    if (enable !== currentlyEnabled && !incompatible) {
      // Ensure the outside world knows about our changes
      changePlaylistFn(playlist);

      if (enable) {
        loader.trigger('renditionenabled');
      } else {
        loader.trigger('renditiondisabled');
      }
    }

    return enable;
  };
};
/**
 * The representation object encapsulates the publicly visible information
 * in a media playlist along with a setter/getter-type function (enabled)
 * for changing the enabled-state of a particular playlist entry
 *
 * @class Representation
 */


var Representation = function Representation(vhsHandler, playlist, id) {
  var pc = vhsHandler.playlistController_;
  var qualityChangeFunction = pc.fastQualityChange_.bind(pc); // some playlist attributes are optional

  if (playlist.attributes) {
    var resolution = playlist.attributes.RESOLUTION;
    this.width = resolution && resolution.width;
    this.height = resolution && resolution.height;
    this.bandwidth = playlist.attributes.BANDWIDTH;
    this.frameRate = playlist.attributes['FRAME-RATE'];
  }

  this.codecs = codecsForPlaylist(pc.main(), playlist);
  this.playlist = playlist; // The id is simply the ordinality of the media playlist
  // within the main playlist

  this.id = id; // Partially-apply the enableFunction to create a playlist-
  // specific variant

  this.enabled = enableFunction(vhsHandler.playlists, playlist.id, qualityChangeFunction);
};
/**
 * A mixin function that adds the `representations` api to an instance
 * of the VhsHandler class
 *
 * @param {VhsHandler} vhsHandler - An instance of VhsHandler to add the
 * representation API into
 */


var renditionSelectionMixin = function renditionSelectionMixin(vhsHandler) {
  // Add a single API-specific function to the VhsHandler instance
  vhsHandler.representations = function () {
    var main = vhsHandler.playlistController_.main();
    var playlists = isAudioOnly(main) ? vhsHandler.playlistController_.getAudioTrackPlaylists_() : main.playlists;

    if (!playlists) {
      return [];
    }

    return playlists.filter(function (media) {
      return !isIncompatible(media);
    }).map(function (e, i) {
      return new Representation(vhsHandler, e, e.id);
    });
  };
};

/**
 * @file playback-watcher.js
 *
 * Playback starts, and now my watch begins. It shall not end until my death. I shall
 * take no wait, hold no uncleared timeouts, father no bad seeks. I shall wear no crowns
 * and win no glory. I shall live and die at my post. I am the corrector of the underflow.
 * I am the watcher of gaps. I am the shield that guards the realms of seekable. I pledge
 * my life and honor to the Playback Watch, for this Player and all the Players to come.
 */

var timerCancelEvents = ['seeking', 'seeked', 'pause', 'playing', 'error'];
/**
 * @class PlaybackWatcher
 */

var PlaybackWatcher = /*#__PURE__*/function () {
  /**
   * Represents an PlaybackWatcher object.
   *
   * @class
   * @param {Object} options an object that includes the tech and settings
   */
  function PlaybackWatcher(options) {
    var _this = this;

    this.playlistController_ = options.playlistController;
    this.tech_ = options.tech;
    this.seekable = options.seekable;
    this.allowSeeksWithinUnsafeLiveWindow = options.allowSeeksWithinUnsafeLiveWindow;
    this.liveRangeSafeTimeDelta = options.liveRangeSafeTimeDelta;
    this.media = options.media;
    this.consecutiveUpdates = 0;
    this.lastRecordedTime = null;
    this.checkCurrentTimeTimeout_ = null;
    this.logger_ = logger('PlaybackWatcher');
    this.logger_('initialize');

    var playHandler = function playHandler() {
      return _this.monitorCurrentTime_();
    };

    var canPlayHandler = function canPlayHandler() {
      return _this.monitorCurrentTime_();
    };

    var waitingHandler = function waitingHandler() {
      return _this.techWaiting_();
    };

    var cancelTimerHandler = function cancelTimerHandler() {
      return _this.resetTimeUpdate_();
    };

    var pc = this.playlistController_;
    var loaderTypes = ['main', 'subtitle', 'audio'];
    var loaderChecks = {};
    loaderTypes.forEach(function (type) {
      loaderChecks[type] = {
        reset: function reset() {
          return _this.resetSegmentDownloads_(type);
        },
        updateend: function updateend() {
          return _this.checkSegmentDownloads_(type);
        }
      };
      pc[type + "SegmentLoader_"].on('appendsdone', loaderChecks[type].updateend); // If a rendition switch happens during a playback stall where the buffer
      // isn't changing we want to reset. We cannot assume that the new rendition
      // will also be stalled, until after new appends.

      pc[type + "SegmentLoader_"].on('playlistupdate', loaderChecks[type].reset); // Playback stalls should not be detected right after seeking.
      // This prevents one segment playlists (single vtt or single segment content)
      // from being detected as stalling. As the buffer will not change in those cases, since
      // the buffer is the entire video duration.

      _this.tech_.on(['seeked', 'seeking'], loaderChecks[type].reset);
    });
    /**
     * We check if a seek was into a gap through the following steps:
     * 1. We get a seeking event and we do not get a seeked event. This means that
     *    a seek was attempted but not completed.
     * 2. We run `fixesBadSeeks_` on segment loader appends. This means that we already
     *    removed everything from our buffer and appended a segment, and should be ready
     *    to check for gaps.
     */

    var setSeekingHandlers = function setSeekingHandlers(fn) {
      ['main', 'audio'].forEach(function (type) {
        pc[type + "SegmentLoader_"][fn]('appended', _this.seekingAppendCheck_);
      });
    };

    this.seekingAppendCheck_ = function () {
      if (_this.fixesBadSeeks_()) {
        _this.consecutiveUpdates = 0;
        _this.lastRecordedTime = _this.tech_.currentTime();
        setSeekingHandlers('off');
      }
    };

    this.clearSeekingAppendCheck_ = function () {
      return setSeekingHandlers('off');
    };

    this.watchForBadSeeking_ = function () {
      _this.clearSeekingAppendCheck_();

      setSeekingHandlers('on');
    };

    this.tech_.on('seeked', this.clearSeekingAppendCheck_);
    this.tech_.on('seeking', this.watchForBadSeeking_);
    this.tech_.on('waiting', waitingHandler);
    this.tech_.on(timerCancelEvents, cancelTimerHandler);
    this.tech_.on('canplay', canPlayHandler);
    /*
      An edge case exists that results in gaps not being skipped when they exist at the beginning of a stream. This case
      is surfaced in one of two ways:
        1)  The `waiting` event is fired before the player has buffered content, making it impossible
          to find or skip the gap. The `waiting` event is followed by a `play` event. On first play
          we can check if playback is stalled due to a gap, and skip the gap if necessary.
      2)  A source with a gap at the beginning of the stream is loaded programatically while the player
          is in a playing state. To catch this case, it's important that our one-time play listener is setup
          even if the player is in a playing state
    */

    this.tech_.one('play', playHandler); // Define the dispose function to clean up our events

    this.dispose = function () {
      _this.clearSeekingAppendCheck_();

      _this.logger_('dispose');

      _this.tech_.off('waiting', waitingHandler);

      _this.tech_.off(timerCancelEvents, cancelTimerHandler);

      _this.tech_.off('canplay', canPlayHandler);

      _this.tech_.off('play', playHandler);

      _this.tech_.off('seeking', _this.watchForBadSeeking_);

      _this.tech_.off('seeked', _this.clearSeekingAppendCheck_);

      loaderTypes.forEach(function (type) {
        pc[type + "SegmentLoader_"].off('appendsdone', loaderChecks[type].updateend);
        pc[type + "SegmentLoader_"].off('playlistupdate', loaderChecks[type].reset);

        _this.tech_.off(['seeked', 'seeking'], loaderChecks[type].reset);
      });

      if (_this.checkCurrentTimeTimeout_) {
        window$1.clearTimeout(_this.checkCurrentTimeTimeout_);
      }

      _this.resetTimeUpdate_();
    };
  }
  /**
   * Periodically check current time to see if playback stopped
   *
   * @private
   */


  var _proto = PlaybackWatcher.prototype;

  _proto.monitorCurrentTime_ = function monitorCurrentTime_() {
    this.checkCurrentTime_();

    if (this.checkCurrentTimeTimeout_) {
      window$1.clearTimeout(this.checkCurrentTimeTimeout_);
    } // 42 = 24 fps // 250 is what Webkit uses // FF uses 15


    this.checkCurrentTimeTimeout_ = window$1.setTimeout(this.monitorCurrentTime_.bind(this), 250);
  }
  /**
   * Reset stalled download stats for a specific type of loader
   *
   * @param {string} type
   *        The segment loader type to check.
   *
   * @listens SegmentLoader#playlistupdate
   * @listens Tech#seeking
   * @listens Tech#seeked
   */
  ;

  _proto.resetSegmentDownloads_ = function resetSegmentDownloads_(type) {
    var loader = this.playlistController_[type + "SegmentLoader_"];

    if (this[type + "StalledDownloads_"] > 0) {
      this.logger_("resetting possible stalled download count for " + type + " loader");
    }

    this[type + "StalledDownloads_"] = 0;
    this[type + "Buffered_"] = loader.buffered_();
  }
  /**
   * Checks on every segment `appendsdone` to see
   * if segment appends are making progress. If they are not
   * and we are still downloading bytes. We exclude the playlist.
   *
   * @param {string} type
   *        The segment loader type to check.
   *
   * @listens SegmentLoader#appendsdone
   */
  ;

  _proto.checkSegmentDownloads_ = function checkSegmentDownloads_(type) {
    var pc = this.playlistController_;
    var loader = pc[type + "SegmentLoader_"];
    var buffered = loader.buffered_();
    var isBufferedDifferent = isRangeDifferent(this[type + "Buffered_"], buffered);
    this[type + "Buffered_"] = buffered; // if another watcher is going to fix the issue or
    // the buffered value for this loader changed
    // appends are working

    if (isBufferedDifferent) {
      this.resetSegmentDownloads_(type);
      return;
    }

    this[type + "StalledDownloads_"]++;
    this.logger_("found #" + this[type + "StalledDownloads_"] + " " + type + " appends that did not increase buffer (possible stalled download)", {
      playlistId: loader.playlist_ && loader.playlist_.id,
      buffered: timeRangesToArray(buffered)
    }); // after 10 possibly stalled appends with no reset, exclude

    if (this[type + "StalledDownloads_"] < 10) {
      return;
    }

    this.logger_(type + " loader stalled download exclusion");
    this.resetSegmentDownloads_(type);
    this.tech_.trigger({
      type: 'usage',
      name: "vhs-" + type + "-download-exclusion"
    });

    if (type === 'subtitle') {
      return;
    } // TODO: should we exclude audio tracks rather than main tracks
    // when type is audio?
    // pc.excludePlaylist({
    //   error: { message: `Excessive ${type} segment downloading detected.` },
    //   playlistExclusionDuration: Infinity
    // });

  }
  /**
   * The purpose of this function is to emulate the "waiting" event on
   * browsers that do not emit it when they are waiting for more
   * data to continue playback
   *
   * @private
   */
  ;

  _proto.checkCurrentTime_ = function checkCurrentTime_() {
    if (this.tech_.paused() || this.tech_.seeking()) {
      return;
    }

    var currentTime = this.tech_.currentTime();
    var buffered = this.tech_.buffered();

    if (this.lastRecordedTime === currentTime && (!buffered.length || currentTime + SAFE_TIME_DELTA >= buffered.end(buffered.length - 1))) {
      // If current time is at the end of the final buffered region, then any playback
      // stall is most likely caused by buffering in a low bandwidth environment. The tech
      // should fire a `waiting` event in this scenario, but due to browser and tech
      // inconsistencies. Calling `techWaiting_` here allows us to simulate
      // responding to a native `waiting` event when the tech fails to emit one.
      return this.techWaiting_();
    }

    if (this.consecutiveUpdates >= 5 && currentTime === this.lastRecordedTime) {
      this.consecutiveUpdates++;
      this.waiting_();
    } else if (currentTime === this.lastRecordedTime) {
      this.consecutiveUpdates++;
    } else {
      this.consecutiveUpdates = 0;
      this.lastRecordedTime = currentTime;
    }
  }
  /**
   * Resets the 'timeupdate' mechanism designed to detect that we are stalled
   *
   * @private
   */
  ;

  _proto.resetTimeUpdate_ = function resetTimeUpdate_() {
    this.consecutiveUpdates = 0;
  }
  /**
   * Fixes situations where there's a bad seek
   *
   * @return {boolean} whether an action was taken to fix the seek
   * @private
   */
  ;

  _proto.fixesBadSeeks_ = function fixesBadSeeks_() {
    var seeking = this.tech_.seeking();

    if (!seeking) {
      return false;
    } // TODO: It's possible that these seekable checks should be moved out of this function
    // and into a function that runs on seekablechange. It's also possible that we only need
    // afterSeekableWindow as the buffered check at the bottom is good enough to handle before
    // seekable range.


    var seekable = this.seekable();
    var currentTime = this.tech_.currentTime();
    var isAfterSeekableRange = this.afterSeekableWindow_(seekable, currentTime, this.media(), this.allowSeeksWithinUnsafeLiveWindow);
    var seekTo;

    if (isAfterSeekableRange) {
      var seekableEnd = seekable.end(seekable.length - 1); // sync to live point (if VOD, our seekable was updated and we're simply adjusting)

      seekTo = seekableEnd;
    }

    if (this.beforeSeekableWindow_(seekable, currentTime)) {
      var seekableStart = seekable.start(0); // sync to the beginning of the live window
      // provide a buffer of .1 seconds to handle rounding/imprecise numbers

      seekTo = seekableStart + ( // if the playlist is too short and the seekable range is an exact time (can
      // happen in live with a 3 segment playlist), then don't use a time delta
      seekableStart === seekable.end(0) ? 0 : SAFE_TIME_DELTA);
    }

    if (typeof seekTo !== 'undefined') {
      this.logger_("Trying to seek outside of seekable at time " + currentTime + " with " + ("seekable range " + printableRange(seekable) + ". Seeking to ") + (seekTo + "."));
      this.tech_.setCurrentTime(seekTo);
      return true;
    }

    var sourceUpdater = this.playlistController_.sourceUpdater_;
    var buffered = this.tech_.buffered();
    var audioBuffered = sourceUpdater.audioBuffer ? sourceUpdater.audioBuffered() : null;
    var videoBuffered = sourceUpdater.videoBuffer ? sourceUpdater.videoBuffered() : null;
    var media = this.media(); // verify that at least two segment durations or one part duration have been
    // appended before checking for a gap.

    var minAppendedDuration = media.partTargetDuration ? media.partTargetDuration : (media.targetDuration - TIME_FUDGE_FACTOR) * 2; // verify that at least two segment durations have been
    // appended before checking for a gap.

    var bufferedToCheck = [audioBuffered, videoBuffered];

    for (var i = 0; i < bufferedToCheck.length; i++) {
      // skip null buffered
      if (!bufferedToCheck[i]) {
        continue;
      }

      var timeAhead = timeAheadOf(bufferedToCheck[i], currentTime); // if we are less than two video/audio segment durations or one part
      // duration behind we haven't appended enough to call this a bad seek.

      if (timeAhead < minAppendedDuration) {
        return false;
      }
    }

    var nextRange = findNextRange(buffered, currentTime); // we have appended enough content, but we don't have anything buffered
    // to seek over the gap

    if (nextRange.length === 0) {
      return false;
    }

    seekTo = nextRange.start(0) + SAFE_TIME_DELTA;
    this.logger_("Buffered region starts (" + nextRange.start(0) + ") " + (" just beyond seek point (" + currentTime + "). Seeking to " + seekTo + "."));
    this.tech_.setCurrentTime(seekTo);
    return true;
  }
  /**
   * Handler for situations when we determine the player is waiting.
   *
   * @private
   */
  ;

  _proto.waiting_ = function waiting_() {
    if (this.techWaiting_()) {
      return;
    } // All tech waiting checks failed. Use last resort correction


    var currentTime = this.tech_.currentTime();
    var buffered = this.tech_.buffered();
    var currentRange = findRange(buffered, currentTime); // Sometimes the player can stall for unknown reasons within a contiguous buffered
    // region with no indication that anything is amiss (seen in Firefox). Seeking to
    // currentTime is usually enough to kickstart the player. This checks that the player
    // is currently within a buffered region before attempting a corrective seek.
    // Chrome does not appear to continue `timeupdate` events after a `waiting` event
    // until there is ~ 3 seconds of forward buffer available. PlaybackWatcher should also
    // make sure there is ~3 seconds of forward buffer before taking any corrective action
    // to avoid triggering an `unknownwaiting` event when the network is slow.

    if (currentRange.length && currentTime + 3 <= currentRange.end(0)) {
      this.resetTimeUpdate_();
      this.tech_.setCurrentTime(currentTime);
      this.logger_("Stopped at " + currentTime + " while inside a buffered region " + ("[" + currentRange.start(0) + " -> " + currentRange.end(0) + "]. Attempting to resume ") + 'playback by seeking to the current time.'); // unknown waiting corrections may be useful for monitoring QoS

      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-unknown-waiting'
      });
      return;
    }
  }
  /**
   * Handler for situations when the tech fires a `waiting` event
   *
   * @return {boolean}
   *         True if an action (or none) was needed to correct the waiting. False if no
   *         checks passed
   * @private
   */
  ;

  _proto.techWaiting_ = function techWaiting_() {
    var seekable = this.seekable();
    var currentTime = this.tech_.currentTime();

    if (this.tech_.seeking()) {
      // Tech is seeking or already waiting on another action, no action needed
      return true;
    }

    if (this.beforeSeekableWindow_(seekable, currentTime)) {
      var livePoint = seekable.end(seekable.length - 1);
      this.logger_("Fell out of live window at time " + currentTime + ". Seeking to " + ("live point (seekable end) " + livePoint));
      this.resetTimeUpdate_();
      this.tech_.setCurrentTime(livePoint); // live window resyncs may be useful for monitoring QoS

      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-live-resync'
      });
      return true;
    }

    var sourceUpdater = this.tech_.vhs.playlistController_.sourceUpdater_;
    var buffered = this.tech_.buffered();
    var videoUnderflow = this.videoUnderflow_({
      audioBuffered: sourceUpdater.audioBuffered(),
      videoBuffered: sourceUpdater.videoBuffered(),
      currentTime: currentTime
    });

    if (videoUnderflow) {
      // Even though the video underflowed and was stuck in a gap, the audio overplayed
      // the gap, leading currentTime into a buffered range. Seeking to currentTime
      // allows the video to catch up to the audio position without losing any audio
      // (only suffering ~3 seconds of frozen video and a pause in audio playback).
      this.resetTimeUpdate_();
      this.tech_.setCurrentTime(currentTime); // video underflow may be useful for monitoring QoS

      this.tech_.trigger({
        type: 'usage',
        name: 'vhs-video-underflow'
      });
      return true;
    }

    var nextRange = findNextRange(buffered, currentTime); // check for gap

    if (nextRange.length > 0) {
      this.logger_("Stopped at " + currentTime + " and seeking to " + nextRange.start(0));
      this.resetTimeUpdate_();
      this.skipTheGap_(currentTime);
      return true;
    } // All checks failed. Returning false to indicate failure to correct waiting


    return false;
  };

  _proto.afterSeekableWindow_ = function afterSeekableWindow_(seekable, currentTime, playlist, allowSeeksWithinUnsafeLiveWindow) {
    if (allowSeeksWithinUnsafeLiveWindow === void 0) {
      allowSeeksWithinUnsafeLiveWindow = false;
    }

    if (!seekable.length) {
      // we can't make a solid case if there's no seekable, default to false
      return false;
    }

    var allowedEnd = seekable.end(seekable.length - 1) + SAFE_TIME_DELTA;
    var isLive = !playlist.endList;
    var isLLHLS = typeof playlist.partTargetDuration === 'number';

    if (isLive && (isLLHLS || allowSeeksWithinUnsafeLiveWindow)) {
      allowedEnd = seekable.end(seekable.length - 1) + playlist.targetDuration * 3;
    }

    if (currentTime > allowedEnd) {
      return true;
    }

    return false;
  };

  _proto.beforeSeekableWindow_ = function beforeSeekableWindow_(seekable, currentTime) {
    if (seekable.length && // can't fall before 0 and 0 seekable start identifies VOD stream
    seekable.start(0) > 0 && currentTime < seekable.start(0) - this.liveRangeSafeTimeDelta) {
      return true;
    }

    return false;
  };

  _proto.videoUnderflow_ = function videoUnderflow_(_ref) {
    var videoBuffered = _ref.videoBuffered,
        audioBuffered = _ref.audioBuffered,
        currentTime = _ref.currentTime;

    // audio only content will not have video underflow :)
    if (!videoBuffered) {
      return;
    }

    var gap; // find a gap in demuxed content.

    if (videoBuffered.length && audioBuffered.length) {
      // in Chrome audio will continue to play for ~3s when we run out of video
      // so we have to check that the video buffer did have some buffer in the
      // past.
      var lastVideoRange = findRange(videoBuffered, currentTime - 3);
      var videoRange = findRange(videoBuffered, currentTime);
      var audioRange = findRange(audioBuffered, currentTime);

      if (audioRange.length && !videoRange.length && lastVideoRange.length) {
        gap = {
          start: lastVideoRange.end(0),
          end: audioRange.end(0)
        };
      } // find a gap in muxed content.

    } else {
      var nextRange = findNextRange(videoBuffered, currentTime); // Even if there is no available next range, there is still a possibility we are
      // stuck in a gap due to video underflow.

      if (!nextRange.length) {
        gap = this.gapFromVideoUnderflow_(videoBuffered, currentTime);
      }
    }

    if (gap) {
      this.logger_("Encountered a gap in video from " + gap.start + " to " + gap.end + ". " + ("Seeking to current time " + currentTime));
      return true;
    }

    return false;
  }
  /**
   * Timer callback. If playback still has not proceeded, then we seek
   * to the start of the next buffered region.
   *
   * @private
   */
  ;

  _proto.skipTheGap_ = function skipTheGap_(scheduledCurrentTime) {
    var buffered = this.tech_.buffered();
    var currentTime = this.tech_.currentTime();
    var nextRange = findNextRange(buffered, currentTime);
    this.resetTimeUpdate_();

    if (nextRange.length === 0 || currentTime !== scheduledCurrentTime) {
      return;
    }

    this.logger_('skipTheGap_:', 'currentTime:', currentTime, 'scheduled currentTime:', scheduledCurrentTime, 'nextRange start:', nextRange.start(0)); // only seek if we still have not played

    this.tech_.setCurrentTime(nextRange.start(0) + TIME_FUDGE_FACTOR);
    this.tech_.trigger({
      type: 'usage',
      name: 'vhs-gap-skip'
    });
  };

  _proto.gapFromVideoUnderflow_ = function gapFromVideoUnderflow_(buffered, currentTime) {
    // At least in Chrome, if there is a gap in the video buffer, the audio will continue
    // playing for ~3 seconds after the video gap starts. This is done to account for
    // video buffer underflow/underrun (note that this is not done when there is audio
    // buffer underflow/underrun -- in that case the video will stop as soon as it
    // encounters the gap, as audio stalls are more noticeable/jarring to a user than
    // video stalls). The player's time will reflect the playthrough of audio, so the
    // time will appear as if we are in a buffered region, even if we are stuck in a
    // "gap."
    //
    // Example:
    // video buffer:   0 => 10.1, 10.2 => 20
    // audio buffer:   0 => 20
    // overall buffer: 0 => 10.1, 10.2 => 20
    // current time: 13
    //
    // Chrome's video froze at 10 seconds, where the video buffer encountered the gap,
    // however, the audio continued playing until it reached ~3 seconds past the gap
    // (13 seconds), at which point it stops as well. Since current time is past the
    // gap, findNextRange will return no ranges.
    //
    // To check for this issue, we see if there is a gap that starts somewhere within
    // a 3 second range (3 seconds +/- 1 second) back from our current time.
    var gaps = findGaps(buffered);

    for (var i = 0; i < gaps.length; i++) {
      var start = gaps.start(i);
      var end = gaps.end(i); // gap is starts no more than 4 seconds back

      if (currentTime - start < 4 && currentTime - start > 2) {
        return {
          start: start,
          end: end
        };
      }
    }

    return null;
  };

  return PlaybackWatcher;
}();

var defaultOptions = {
  errorInterval: 30,
  getSource: function getSource(next) {
    var tech = this.tech({
      IWillNotUseThisInPlugins: true
    });
    var sourceObj = tech.currentSource_ || this.currentSource();
    return next(sourceObj);
  }
};
/**
 * Main entry point for the plugin
 *
 * @param {Player} player a reference to a videojs Player instance
 * @param {Object} [options] an object with plugin options
 * @private
 */

var initPlugin = function initPlugin(player, options) {
  var lastCalled = 0;
  var seekTo = 0;
  var localOptions = merge(defaultOptions, options);
  player.ready(function () {
    player.trigger({
      type: 'usage',
      name: 'vhs-error-reload-initialized'
    });
  });
  /**
   * Player modifications to perform that must wait until `loadedmetadata`
   * has been triggered
   *
   * @private
   */

  var loadedMetadataHandler = function loadedMetadataHandler() {
    if (seekTo) {
      player.currentTime(seekTo);
    }
  };
  /**
   * Set the source on the player element, play, and seek if necessary
   *
   * @param {Object} sourceObj An object specifying the source url and mime-type to play
   * @private
   */


  var setSource = function setSource(sourceObj) {
    if (sourceObj === null || sourceObj === undefined) {
      return;
    }

    seekTo = player.duration() !== Infinity && player.currentTime() || 0;
    player.one('loadedmetadata', loadedMetadataHandler);
    player.src(sourceObj);
    player.trigger({
      type: 'usage',
      name: 'vhs-error-reload'
    });
    player.play();
  };
  /**
   * Attempt to get a source from either the built-in getSource function
   * or a custom function provided via the options
   *
   * @private
   */


  var errorHandler = function errorHandler() {
    // Do not attempt to reload the source if a source-reload occurred before
    // 'errorInterval' time has elapsed since the last source-reload
    if (Date.now() - lastCalled < localOptions.errorInterval * 1000) {
      player.trigger({
        type: 'usage',
        name: 'vhs-error-reload-canceled'
      });
      return;
    }

    if (!localOptions.getSource || typeof localOptions.getSource !== 'function') {
      videojs.log.error('ERROR: reloadSourceOnError - The option getSource must be a function!');
      return;
    }

    lastCalled = Date.now();
    return localOptions.getSource.call(player, setSource);
  };
  /**
   * Unbind any event handlers that were bound by the plugin
   *
   * @private
   */


  var cleanupEvents = function cleanupEvents() {
    player.off('loadedmetadata', loadedMetadataHandler);
    player.off('error', errorHandler);
    player.off('dispose', cleanupEvents);
  };
  /**
   * Cleanup before re-initializing the plugin
   *
   * @param {Object} [newOptions] an object with plugin options
   * @private
   */


  var reinitPlugin = function reinitPlugin(newOptions) {
    cleanupEvents();
    initPlugin(player, newOptions);
  };

  player.on('error', errorHandler);
  player.on('dispose', cleanupEvents); // Overwrite the plugin function so that we can correctly cleanup before
  // initializing the plugin

  player.reloadSourceOnError = reinitPlugin;
};
/**
 * Reload the source when an error is detected as long as there
 * wasn't an error previously within the last 30 seconds
 *
 * @param {Object} [options] an object with plugin options
 */


var reloadSourceOnError = function reloadSourceOnError(options) {
  initPlugin(this, options);
};

var version$4 = "3.12.2";

var version$3 = "6.0.1";

var version$2 = "0.21.1";

var version$1 = "4.7.1";

var version = "3.1.3";

var Vhs = {
  PlaylistLoader: PlaylistLoader,
  Playlist: Playlist,
  utils: utils,
  STANDARD_PLAYLIST_SELECTOR: lastBandwidthSelector,
  INITIAL_PLAYLIST_SELECTOR: lowestBitrateCompatibleVariantSelector,
  lastBandwidthSelector: lastBandwidthSelector,
  movingAverageBandwidthSelector: movingAverageBandwidthSelector,
  comparePlaylistBandwidth: comparePlaylistBandwidth,
  comparePlaylistResolution: comparePlaylistResolution,
  xhr: xhrFactory()
}; // Define getter/setters for config properties

Object.keys(Config).forEach(function (prop) {
  Object.defineProperty(Vhs, prop, {
    get: function get() {
      videojs.log.warn("using Vhs." + prop + " is UNSAFE be sure you know what you are doing");
      return Config[prop];
    },
    set: function set(value) {
      videojs.log.warn("using Vhs." + prop + " is UNSAFE be sure you know what you are doing");

      if (typeof value !== 'number' || value < 0) {
        videojs.log.warn("value of Vhs." + prop + " must be greater than or equal to 0");
        return;
      }

      Config[prop] = value;
    }
  });
});
var LOCAL_STORAGE_KEY = 'videojs-vhs';
/**
 * Updates the selectedIndex of the QualityLevelList when a mediachange happens in vhs.
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to update.
 * @param {PlaylistLoader} playlistLoader PlaylistLoader containing the new media info.
 * @function handleVhsMediaChange
 */

var handleVhsMediaChange = function handleVhsMediaChange(qualityLevels, playlistLoader) {
  var newPlaylist = playlistLoader.media();
  var selectedIndex = -1;

  for (var i = 0; i < qualityLevels.length; i++) {
    if (qualityLevels[i].id === newPlaylist.id) {
      selectedIndex = i;
      break;
    }
  }

  qualityLevels.selectedIndex_ = selectedIndex;
  qualityLevels.trigger({
    selectedIndex: selectedIndex,
    type: 'change'
  });
};
/**
 * Adds quality levels to list once playlist metadata is available
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to attach events to.
 * @param {Object} vhs Vhs object to listen to for media events.
 * @function handleVhsLoadedMetadata
 */


var handleVhsLoadedMetadata = function handleVhsLoadedMetadata(qualityLevels, vhs) {
  vhs.representations().forEach(function (rep) {
    qualityLevels.addQualityLevel(rep);
  });
  handleVhsMediaChange(qualityLevels, vhs.playlists);
}; // VHS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.


Vhs.canPlaySource = function () {
  return videojs.log.warn('VHS is no longer a tech. Please remove it from ' + 'your player\'s techOrder.');
};

var emeKeySystems = function emeKeySystems(keySystemOptions, mainPlaylist, audioPlaylist) {
  if (!keySystemOptions) {
    return keySystemOptions;
  }

  var codecs = {};

  if (mainPlaylist && mainPlaylist.attributes && mainPlaylist.attributes.CODECS) {
    codecs = unwrapCodecList(parseCodecs(mainPlaylist.attributes.CODECS));
  }

  if (audioPlaylist && audioPlaylist.attributes && audioPlaylist.attributes.CODECS) {
    codecs.audio = audioPlaylist.attributes.CODECS;
  }

  var videoContentType = getMimeForCodec(codecs.video);
  var audioContentType = getMimeForCodec(codecs.audio); // upsert the content types based on the selected playlist

  var keySystemContentTypes = {};

  for (var keySystem in keySystemOptions) {
    keySystemContentTypes[keySystem] = {};

    if (audioContentType) {
      keySystemContentTypes[keySystem].audioContentType = audioContentType;
    }

    if (videoContentType) {
      keySystemContentTypes[keySystem].videoContentType = videoContentType;
    } // Default to using the video playlist's PSSH even though they may be different, as
    // videojs-contrib-eme will only accept one in the options.
    //
    // This shouldn't be an issue for most cases as early intialization will handle all
    // unique PSSH values, and if they aren't, then encrypted events should have the
    // specific information needed for the unique license.


    if (mainPlaylist.contentProtection && mainPlaylist.contentProtection[keySystem] && mainPlaylist.contentProtection[keySystem].pssh) {
      keySystemContentTypes[keySystem].pssh = mainPlaylist.contentProtection[keySystem].pssh;
    } // videojs-contrib-eme accepts the option of specifying: 'com.some.cdm': 'url'
    // so we need to prevent overwriting the URL entirely


    if (typeof keySystemOptions[keySystem] === 'string') {
      keySystemContentTypes[keySystem].url = keySystemOptions[keySystem];
    }
  }

  return merge(keySystemOptions, keySystemContentTypes);
};
/**
 * @typedef {Object} KeySystems
 *
 * keySystems configuration for https://github.com/videojs/videojs-contrib-eme
 * Note: not all options are listed here.
 *
 * @property {Uint8Array} [pssh]
 *           Protection System Specific Header
 */

/**
 * Goes through all the playlists and collects an array of KeySystems options objects
 * containing each playlist's keySystems and their pssh values, if available.
 *
 * @param {Object[]} playlists
 *        The playlists to look through
 * @param {string[]} keySystems
 *        The keySystems to collect pssh values for
 *
 * @return {KeySystems[]}
 *         An array of KeySystems objects containing available key systems and their
 *         pssh values
 */


var getAllPsshKeySystemsOptions = function getAllPsshKeySystemsOptions(playlists, keySystems) {
  return playlists.reduce(function (keySystemsArr, playlist) {
    if (!playlist.contentProtection) {
      return keySystemsArr;
    }

    var keySystemsOptions = keySystems.reduce(function (keySystemsObj, keySystem) {
      var keySystemOptions = playlist.contentProtection[keySystem];

      if (keySystemOptions && keySystemOptions.pssh) {
        keySystemsObj[keySystem] = {
          pssh: keySystemOptions.pssh
        };
      }

      return keySystemsObj;
    }, {});

    if (Object.keys(keySystemsOptions).length) {
      keySystemsArr.push(keySystemsOptions);
    }

    return keySystemsArr;
  }, []);
};
/**
 * Returns a promise that waits for the
 * [eme plugin](https://github.com/videojs/videojs-contrib-eme) to create a key session.
 *
 * Works around https://bugs.chromium.org/p/chromium/issues/detail?id=895449 in non-IE11
 * browsers.
 *
 * As per the above ticket, this is particularly important for Chrome, where, if
 * unencrypted content is appended before encrypted content and the key session has not
 * been created, a MEDIA_ERR_DECODE will be thrown once the encrypted content is reached
 * during playback.
 *
 * @param {Object} player
 *        The player instance
 * @param {Object[]} sourceKeySystems
 *        The key systems options from the player source
 * @param {Object} [audioMedia]
 *        The active audio media playlist (optional)
 * @param {Object[]} mainPlaylists
 *        The playlists found on the main playlist object
 *
 * @return {Object}
 *         Promise that resolves when the key session has been created
 */


var waitForKeySessionCreation = function waitForKeySessionCreation(_ref) {
  var player = _ref.player,
      sourceKeySystems = _ref.sourceKeySystems,
      audioMedia = _ref.audioMedia,
      mainPlaylists = _ref.mainPlaylists;

  if (!player.eme.initializeMediaKeys) {
    return Promise.resolve();
  } // TODO should all audio PSSH values be initialized for DRM?
  //
  // All unique video rendition pssh values are initialized for DRM, but here only
  // the initial audio playlist license is initialized. In theory, an encrypted
  // event should be fired if the user switches to an alternative audio playlist
  // where a license is required, but this case hasn't yet been tested. In addition, there
  // may be many alternate audio playlists unlikely to be used (e.g., multiple different
  // languages).


  var playlists = audioMedia ? mainPlaylists.concat([audioMedia]) : mainPlaylists;
  var keySystemsOptionsArr = getAllPsshKeySystemsOptions(playlists, Object.keys(sourceKeySystems));
  var initializationFinishedPromises = [];
  var keySessionCreatedPromises = []; // Since PSSH values are interpreted as initData, EME will dedupe any duplicates. The
  // only place where it should not be deduped is for ms-prefixed APIs, but
  // the existence of modern EME APIs in addition to
  // ms-prefixed APIs on Edge should prevent this from being a concern.
  // initializeMediaKeys also won't use the webkit-prefixed APIs.

  keySystemsOptionsArr.forEach(function (keySystemsOptions) {
    keySessionCreatedPromises.push(new Promise(function (resolve, reject) {
      player.tech_.one('keysessioncreated', resolve);
    }));
    initializationFinishedPromises.push(new Promise(function (resolve, reject) {
      player.eme.initializeMediaKeys({
        keySystems: keySystemsOptions
      }, function (err) {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    }));
  }); // The reasons Promise.race is chosen over Promise.any:
  //
  // * Promise.any is only available in Safari 14+.
  // * None of these promises are expected to reject. If they do reject, it might be
  //   better here for the race to surface the rejection, rather than mask it by using
  //   Promise.any.

  return Promise.race([// If a session was previously created, these will all finish resolving without
  // creating a new session, otherwise it will take until the end of all license
  // requests, which is why the key session check is used (to make setup much faster).
  Promise.all(initializationFinishedPromises), // Once a single session is created, the browser knows DRM will be used.
  Promise.race(keySessionCreatedPromises)]);
};
/**
 * If the [eme](https://github.com/videojs/videojs-contrib-eme) plugin is available, and
 * there are keySystems on the source, sets up source options to prepare the source for
 * eme.
 *
 * @param {Object} player
 *        The player instance
 * @param {Object[]} sourceKeySystems
 *        The key systems options from the player source
 * @param {Object} media
 *        The active media playlist
 * @param {Object} [audioMedia]
 *        The active audio media playlist (optional)
 *
 * @return {boolean}
 *         Whether or not options were configured and EME is available
 */

var setupEmeOptions = function setupEmeOptions(_ref2) {
  var player = _ref2.player,
      sourceKeySystems = _ref2.sourceKeySystems,
      media = _ref2.media,
      audioMedia = _ref2.audioMedia;
  var sourceOptions = emeKeySystems(sourceKeySystems, media, audioMedia);

  if (!sourceOptions) {
    return false;
  }

  player.currentSource().keySystems = sourceOptions; // eme handles the rest of the setup, so if it is missing
  // do nothing.

  if (sourceOptions && !player.eme) {
    videojs.log.warn('DRM encrypted source cannot be decrypted without a DRM plugin');
    return false;
  }

  return true;
};

var getVhsLocalStorage = function getVhsLocalStorage() {
  if (!window$1.localStorage) {
    return null;
  }

  var storedObject = window$1.localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!storedObject) {
    return null;
  }

  try {
    return JSON.parse(storedObject);
  } catch (e) {
    // someone may have tampered with the value
    return null;
  }
};

var updateVhsLocalStorage = function updateVhsLocalStorage(options) {
  if (!window$1.localStorage) {
    return false;
  }

  var objectToStore = getVhsLocalStorage();
  objectToStore = objectToStore ? merge(objectToStore, options) : options;

  try {
    window$1.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(objectToStore));
  } catch (e) {
    // Throws if storage is full (e.g., always on iOS 5+ Safari private mode, where
    // storage is set to 0).
    // https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem#Exceptions
    // No need to perform any operation.
    return false;
  }

  return objectToStore;
};
/**
 * Parses VHS-supported media types from data URIs. See
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
 * for information on data URIs.
 *
 * @param {string} dataUri
 *        The data URI
 *
 * @return {string|Object}
 *         The parsed object/string, or the original string if no supported media type
 *         was found
 */


var expandDataUri = function expandDataUri(dataUri) {
  if (dataUri.toLowerCase().indexOf('data:application/vnd.videojs.vhs+json,') === 0) {
    return JSON.parse(dataUri.substring(dataUri.indexOf(',') + 1));
  } // no known case for this data URI, return the string as-is


  return dataUri;
};
/**
 * Adds a request hook to an xhr object
 *
 * @param {Object} xhr object to add the onRequest hook to
 * @param {function} callback hook function for an xhr request
 */


var addOnRequestHook = function addOnRequestHook(xhr, callback) {
  if (!xhr._requestCallbackSet) {
    xhr._requestCallbackSet = new Set();
  }

  xhr._requestCallbackSet.add(callback);
};
/**
 * Adds a response hook to an xhr object
 *
 * @param {Object} xhr object to add the onResponse hook to
 * @param {function} callback hook function for an xhr response
 */


var addOnResponseHook = function addOnResponseHook(xhr, callback) {
  if (!xhr._responseCallbackSet) {
    xhr._responseCallbackSet = new Set();
  }

  xhr._responseCallbackSet.add(callback);
};
/**
 * Removes a request hook on an xhr object, deletes the onRequest set if empty.
 *
 * @param {Object} xhr object to remove the onRequest hook from
 * @param {function} callback hook function to remove
 */


var removeOnRequestHook = function removeOnRequestHook(xhr, callback) {
  if (!xhr._requestCallbackSet) {
    return;
  }

  xhr._requestCallbackSet.delete(callback);

  if (!xhr._requestCallbackSet.size) {
    delete xhr._requestCallbackSet;
  }
};
/**
 * Removes a response hook on an xhr object, deletes the onResponse set if empty.
 *
 * @param {Object} xhr object to remove the onResponse hook from
 * @param {function} callback hook function to remove
 */


var removeOnResponseHook = function removeOnResponseHook(xhr, callback) {
  if (!xhr._responseCallbackSet) {
    return;
  }

  xhr._responseCallbackSet.delete(callback);

  if (!xhr._responseCallbackSet.size) {
    delete xhr._responseCallbackSet;
  }
};
/**
 * Whether the browser has built-in HLS support.
 */


Vhs.supportsNativeHls = function () {
  if (!document || !document.createElement) {
    return false;
  }

  var video = document.createElement('video'); // native HLS is definitely not supported if HTML5 video isn't

  if (!videojs.getTech('Html5').isSupported()) {
    return false;
  } // HLS manifests can go by many mime-types


  var canPlay = [// Apple santioned
  'application/vnd.apple.mpegurl', // Apple sanctioned for backwards compatibility
  'audio/mpegurl', // Very common
  'audio/x-mpegurl', // Very common
  'application/x-mpegurl', // Included for completeness
  'video/x-mpegurl', 'video/mpegurl', 'application/mpegurl'];
  return canPlay.some(function (canItPlay) {
    return /maybe|probably/i.test(video.canPlayType(canItPlay));
  });
}();

Vhs.supportsNativeDash = function () {
  if (!document || !document.createElement || !videojs.getTech('Html5').isSupported()) {
    return false;
  }

  return /maybe|probably/i.test(document.createElement('video').canPlayType('application/dash+xml'));
}();

Vhs.supportsTypeNatively = function (type) {
  if (type === 'hls') {
    return Vhs.supportsNativeHls;
  }

  if (type === 'dash') {
    return Vhs.supportsNativeDash;
  }

  return false;
};
/**
 * VHS is a source handler, not a tech. Make sure attempts to use it
 * as one do not cause exceptions.
 */


Vhs.isSupported = function () {
  return videojs.log.warn('VHS is no longer a tech. Please remove it from ' + 'your player\'s techOrder.');
};
/**
 * A global function for setting an onRequest hook
 *
 * @param {function} callback for request modifiction
 */


Vhs.xhr.onRequest = function (callback) {
  addOnRequestHook(Vhs.xhr, callback);
};
/**
 * A global function for setting an onResponse hook
 *
 * @param {callback} callback for response data retrieval
 */


Vhs.xhr.onResponse = function (callback) {
  addOnResponseHook(Vhs.xhr, callback);
};
/**
 * Deletes a global onRequest callback if it exists
 *
 * @param {function} callback to delete from the global set
 */


Vhs.xhr.offRequest = function (callback) {
  removeOnRequestHook(Vhs.xhr, callback);
};
/**
 * Deletes a global onResponse callback if it exists
 *
 * @param {function} callback to delete from the global set
 */


Vhs.xhr.offResponse = function (callback) {
  removeOnResponseHook(Vhs.xhr, callback);
};

var Component = videojs.getComponent('Component');
/**
 * The Vhs Handler object, where we orchestrate all of the parts
 * of VHS to interact with video.js
 *
 * @class VhsHandler
 * @extends videojs.Component
 * @param {Object} source the soruce object
 * @param {Tech} tech the parent tech object
 * @param {Object} options optional and required options
 */

var VhsHandler = /*#__PURE__*/function (_Component) {
  _inheritsLoose(VhsHandler, _Component);

  function VhsHandler(source, tech, options) {
    var _this;

    _this = _Component.call(this, tech, options.vhs) || this; // if a tech level `initialBandwidth` option was passed
    // use that over the VHS level `bandwidth` option

    if (typeof options.initialBandwidth === 'number') {
      _this.options_.bandwidth = options.initialBandwidth;
    }

    _this.logger_ = logger('VhsHandler'); // we need access to the player in some cases,
    // so, get it from Video.js via the `playerId`

    if (tech.options_ && tech.options_.playerId) {
      var _player = videojs.getPlayer(tech.options_.playerId);

      _this.player_ = _player;
    }

    _this.tech_ = tech;
    _this.source_ = source;
    _this.stats = {};
    _this.ignoreNextSeekingEvent_ = false;

    _this.setOptions_();

    if (_this.options_.overrideNative && tech.overrideNativeAudioTracks && tech.overrideNativeVideoTracks) {
      tech.overrideNativeAudioTracks(true);
      tech.overrideNativeVideoTracks(true);
    } else if (_this.options_.overrideNative && (tech.featuresNativeVideoTracks || tech.featuresNativeAudioTracks)) {
      // overriding native VHS only works if audio tracks have been emulated
      // error early if we're misconfigured
      throw new Error('Overriding native VHS requires emulated tracks. ' + 'See https://git.io/vMpjB');
    } // listen for fullscreenchange events for this player so that we
    // can adjust our quality selection quickly


    _this.on(document, ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'], function (event) {
      var fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

      if (fullscreenElement && fullscreenElement.contains(_this.tech_.el())) {
        _this.playlistController_.fastQualityChange_();
      } else {
        // When leaving fullscreen, since the in page pixel dimensions should be smaller
        // than full screen, see if there should be a rendition switch down to preserve
        // bandwidth.
        _this.playlistController_.checkABR_();
      }
    });

    _this.on(_this.tech_, 'seeking', function () {
      if (this.ignoreNextSeekingEvent_) {
        this.ignoreNextSeekingEvent_ = false;
        return;
      }

      this.setCurrentTime(this.tech_.currentTime());
    });

    _this.on(_this.tech_, 'error', function () {
      // verify that the error was real and we are loaded
      // enough to have pc loaded.
      if (this.tech_.error() && this.playlistController_) {
        this.playlistController_.pauseLoading();
      }
    });

    _this.on(_this.tech_, 'play', _this.play);

    return _this;
  }
  /**
   * Set VHS options based on options from configuration, as well as partial
   * options to be passed at a later time.
   *
   * @param {Object} options A partial chunk of config options
   */


  var _proto = VhsHandler.prototype;

  _proto.setOptions_ = function setOptions_(options) {
    var _this2 = this;

    if (options === void 0) {
      options = {};
    }

    this.options_ = merge(this.options_, options); // defaults

    this.options_.withCredentials = this.options_.withCredentials || false;
    this.options_.limitRenditionByPlayerDimensions = this.options_.limitRenditionByPlayerDimensions === false ? false : true;
    this.options_.useDevicePixelRatio = this.options_.useDevicePixelRatio || false;
    this.options_.useBandwidthFromLocalStorage = typeof this.source_.useBandwidthFromLocalStorage !== 'undefined' ? this.source_.useBandwidthFromLocalStorage : this.options_.useBandwidthFromLocalStorage || false;
    this.options_.useForcedSubtitles = this.options_.useForcedSubtitles || false;
    this.options_.useNetworkInformationApi = this.options_.useNetworkInformationApi || false;
    this.options_.useDtsForTimestampOffset = this.options_.useDtsForTimestampOffset || false;
    this.options_.customTagParsers = this.options_.customTagParsers || [];
    this.options_.customTagMappers = this.options_.customTagMappers || [];
    this.options_.cacheEncryptionKeys = this.options_.cacheEncryptionKeys || false;
    this.options_.llhls = this.options_.llhls === false ? false : true;
    this.options_.bufferBasedABR = this.options_.bufferBasedABR || false;

    if (typeof this.options_.playlistExclusionDuration !== 'number') {
      this.options_.playlistExclusionDuration = 60;
    }

    if (typeof this.options_.bandwidth !== 'number') {
      if (this.options_.useBandwidthFromLocalStorage) {
        var storedObject = getVhsLocalStorage();

        if (storedObject && storedObject.bandwidth) {
          this.options_.bandwidth = storedObject.bandwidth;
          this.tech_.trigger({
            type: 'usage',
            name: 'vhs-bandwidth-from-local-storage'
          });
        }

        if (storedObject && storedObject.throughput) {
          this.options_.throughput = storedObject.throughput;
          this.tech_.trigger({
            type: 'usage',
            name: 'vhs-throughput-from-local-storage'
          });
        }
      }
    } // if bandwidth was not set by options or pulled from local storage, start playlist
    // selection at a reasonable bandwidth


    if (typeof this.options_.bandwidth !== 'number') {
      this.options_.bandwidth = Config.INITIAL_BANDWIDTH;
    } // If the bandwidth number is unchanged from the initial setting
    // then this takes precedence over the enableLowInitialPlaylist option


    this.options_.enableLowInitialPlaylist = this.options_.enableLowInitialPlaylist && this.options_.bandwidth === Config.INITIAL_BANDWIDTH; // grab options passed to player.src

    ['withCredentials', 'useDevicePixelRatio', 'customPixelRatio', 'limitRenditionByPlayerDimensions', 'bandwidth', 'customTagParsers', 'customTagMappers', 'cacheEncryptionKeys', 'playlistSelector', 'initialPlaylistSelector', 'bufferBasedABR', 'liveRangeSafeTimeDelta', 'llhls', 'useForcedSubtitles', 'useNetworkInformationApi', 'useDtsForTimestampOffset', 'exactManifestTimings', 'leastPixelDiffSelector'].forEach(function (option) {
      if (typeof _this2.source_[option] !== 'undefined') {
        _this2.options_[option] = _this2.source_[option];
      }
    });
    this.limitRenditionByPlayerDimensions = this.options_.limitRenditionByPlayerDimensions;
    this.useDevicePixelRatio = this.options_.useDevicePixelRatio;
    var customPixelRatio = this.options_.customPixelRatio; // Ensure the custom pixel ratio is a number greater than or equal to 0

    if (typeof customPixelRatio === 'number' && customPixelRatio >= 0) {
      this.customPixelRatio = customPixelRatio;
    }
  } // alias for public method to set options
  ;

  _proto.setOptions = function setOptions(options) {
    if (options === void 0) {
      options = {};
    }

    this.setOptions_(options);
  }
  /**
   * called when player.src gets called, handle a new source
   *
   * @param {Object} src the source object to handle
   */
  ;

  _proto.src = function src(_src, type) {
    var _this3 = this;

    // do nothing if the src is falsey
    if (!_src) {
      return;
    }

    this.setOptions_(); // add main playlist controller options

    this.options_.src = expandDataUri(this.source_.src);
    this.options_.tech = this.tech_;
    this.options_.externVhs = Vhs;
    this.options_.sourceType = simpleTypeFromSourceType(type); // Whenever we seek internally, we should update the tech

    this.options_.seekTo = function (time) {
      _this3.tech_.setCurrentTime(time);
    };

    this.playlistController_ = new PlaylistController(this.options_);
    var playbackWatcherOptions = merge({
      liveRangeSafeTimeDelta: SAFE_TIME_DELTA
    }, this.options_, {
      seekable: function seekable() {
        return _this3.seekable();
      },
      media: function media() {
        return _this3.playlistController_.media();
      },
      playlistController: this.playlistController_
    });
    this.playbackWatcher_ = new PlaybackWatcher(playbackWatcherOptions);
    this.playlistController_.on('error', function () {
      var player = videojs.players[_this3.tech_.options_.playerId];
      var error = _this3.playlistController_.error;

      if (typeof error === 'object' && !error.code) {
        error.code = 3;
      } else if (typeof error === 'string') {
        error = {
          message: error,
          code: 3
        };
      }

      player.error(error);
    });
    var defaultSelector = this.options_.bufferBasedABR ? Vhs.movingAverageBandwidthSelector(0.55) : Vhs.STANDARD_PLAYLIST_SELECTOR; // `this` in selectPlaylist should be the VhsHandler for backwards
    // compatibility with < v2

    this.playlistController_.selectPlaylist = this.selectPlaylist ? this.selectPlaylist.bind(this) : defaultSelector.bind(this);
    this.playlistController_.selectInitialPlaylist = Vhs.INITIAL_PLAYLIST_SELECTOR.bind(this); // re-expose some internal objects for backwards compatibility with < v2

    this.playlists = this.playlistController_.mainPlaylistLoader_;
    this.mediaSource = this.playlistController_.mediaSource; // Proxy assignment of some properties to the main playlist
    // controller. Using a custom property for backwards compatibility
    // with < v2

    Object.defineProperties(this, {
      selectPlaylist: {
        get: function get() {
          return this.playlistController_.selectPlaylist;
        },
        set: function set(selectPlaylist) {
          this.playlistController_.selectPlaylist = selectPlaylist.bind(this);
        }
      },
      throughput: {
        get: function get() {
          return this.playlistController_.mainSegmentLoader_.throughput.rate;
        },
        set: function set(throughput) {
          this.playlistController_.mainSegmentLoader_.throughput.rate = throughput; // By setting `count` to 1 the throughput value becomes the starting value
          // for the cumulative average

          this.playlistController_.mainSegmentLoader_.throughput.count = 1;
        }
      },
      bandwidth: {
        get: function get() {
          var playerBandwidthEst = this.playlistController_.mainSegmentLoader_.bandwidth;
          var networkInformation = window$1.navigator.connection || window$1.navigator.mozConnection || window$1.navigator.webkitConnection;
          var tenMbpsAsBitsPerSecond = 10e6;

          if (this.options_.useNetworkInformationApi && networkInformation) {
            // downlink returns Mbps
            // https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/downlink
            var networkInfoBandwidthEstBitsPerSec = networkInformation.downlink * 1000 * 1000; // downlink maxes out at 10 Mbps. In the event that both networkInformationApi and the player
            // estimate a bandwidth greater than 10 Mbps, use the larger of the two estimates to ensure that
            // high quality streams are not filtered out.

            if (networkInfoBandwidthEstBitsPerSec >= tenMbpsAsBitsPerSecond && playerBandwidthEst >= tenMbpsAsBitsPerSecond) {
              playerBandwidthEst = Math.max(playerBandwidthEst, networkInfoBandwidthEstBitsPerSec);
            } else {
              playerBandwidthEst = networkInfoBandwidthEstBitsPerSec;
            }
          }

          return playerBandwidthEst;
        },
        set: function set(bandwidth) {
          this.playlistController_.mainSegmentLoader_.bandwidth = bandwidth; // setting the bandwidth manually resets the throughput counter
          // `count` is set to zero that current value of `rate` isn't included
          // in the cumulative average

          this.playlistController_.mainSegmentLoader_.throughput = {
            rate: 0,
            count: 0
          };
        }
      },

      /**
       * `systemBandwidth` is a combination of two serial processes bit-rates. The first
       * is the network bitrate provided by `bandwidth` and the second is the bitrate of
       * the entire process after that - decryption, transmuxing, and appending - provided
       * by `throughput`.
       *
       * Since the two process are serial, the overall system bandwidth is given by:
       *   sysBandwidth = 1 / (1 / bandwidth + 1 / throughput)
       */
      systemBandwidth: {
        get: function get() {
          var invBandwidth = 1 / (this.bandwidth || 1);
          var invThroughput;

          if (this.throughput > 0) {
            invThroughput = 1 / this.throughput;
          } else {
            invThroughput = 0;
          }

          var systemBitrate = Math.floor(1 / (invBandwidth + invThroughput));
          return systemBitrate;
        },
        set: function set() {
          videojs.log.error('The "systemBandwidth" property is read-only');
        }
      }
    });

    if (this.options_.bandwidth) {
      this.bandwidth = this.options_.bandwidth;
    }

    if (this.options_.throughput) {
      this.throughput = this.options_.throughput;
    }

    Object.defineProperties(this.stats, {
      bandwidth: {
        get: function get() {
          return _this3.bandwidth || 0;
        },
        enumerable: true
      },
      mediaRequests: {
        get: function get() {
          return _this3.playlistController_.mediaRequests_() || 0;
        },
        enumerable: true
      },
      mediaRequestsAborted: {
        get: function get() {
          return _this3.playlistController_.mediaRequestsAborted_() || 0;
        },
        enumerable: true
      },
      mediaRequestsTimedout: {
        get: function get() {
          return _this3.playlistController_.mediaRequestsTimedout_() || 0;
        },
        enumerable: true
      },
      mediaRequestsErrored: {
        get: function get() {
          return _this3.playlistController_.mediaRequestsErrored_() || 0;
        },
        enumerable: true
      },
      mediaTransferDuration: {
        get: function get() {
          return _this3.playlistController_.mediaTransferDuration_() || 0;
        },
        enumerable: true
      },
      mediaBytesTransferred: {
        get: function get() {
          return _this3.playlistController_.mediaBytesTransferred_() || 0;
        },
        enumerable: true
      },
      mediaSecondsLoaded: {
        get: function get() {
          return _this3.playlistController_.mediaSecondsLoaded_() || 0;
        },
        enumerable: true
      },
      mediaAppends: {
        get: function get() {
          return _this3.playlistController_.mediaAppends_() || 0;
        },
        enumerable: true
      },
      mainAppendsToLoadedData: {
        get: function get() {
          return _this3.playlistController_.mainAppendsToLoadedData_() || 0;
        },
        enumerable: true
      },
      audioAppendsToLoadedData: {
        get: function get() {
          return _this3.playlistController_.audioAppendsToLoadedData_() || 0;
        },
        enumerable: true
      },
      appendsToLoadedData: {
        get: function get() {
          return _this3.playlistController_.appendsToLoadedData_() || 0;
        },
        enumerable: true
      },
      timeToLoadedData: {
        get: function get() {
          return _this3.playlistController_.timeToLoadedData_() || 0;
        },
        enumerable: true
      },
      buffered: {
        get: function get() {
          return timeRangesToArray(_this3.tech_.buffered());
        },
        enumerable: true
      },
      currentTime: {
        get: function get() {
          return _this3.tech_.currentTime();
        },
        enumerable: true
      },
      currentSource: {
        get: function get() {
          return _this3.tech_.currentSource_;
        },
        enumerable: true
      },
      currentTech: {
        get: function get() {
          return _this3.tech_.name_;
        },
        enumerable: true
      },
      duration: {
        get: function get() {
          return _this3.tech_.duration();
        },
        enumerable: true
      },
      main: {
        get: function get() {
          return _this3.playlists.main;
        },
        enumerable: true
      },
      playerDimensions: {
        get: function get() {
          return _this3.tech_.currentDimensions();
        },
        enumerable: true
      },
      seekable: {
        get: function get() {
          return timeRangesToArray(_this3.tech_.seekable());
        },
        enumerable: true
      },
      timestamp: {
        get: function get() {
          return Date.now();
        },
        enumerable: true
      },
      videoPlaybackQuality: {
        get: function get() {
          return _this3.tech_.getVideoPlaybackQuality();
        },
        enumerable: true
      }
    });
    this.tech_.one('canplay', this.playlistController_.setupFirstPlay.bind(this.playlistController_));
    this.tech_.on('bandwidthupdate', function () {
      if (_this3.options_.useBandwidthFromLocalStorage) {
        updateVhsLocalStorage({
          bandwidth: _this3.bandwidth,
          throughput: Math.round(_this3.throughput)
        });
      }
    });
    this.playlistController_.on('selectedinitialmedia', function () {
      // Add the manual rendition mix-in to VhsHandler
      renditionSelectionMixin(_this3);
    });
    this.playlistController_.sourceUpdater_.on('createdsourcebuffers', function () {
      _this3.setupEme_();
    }); // the bandwidth of the primary segment loader is our best
    // estimate of overall bandwidth

    this.on(this.playlistController_, 'progress', function () {
      this.tech_.trigger('progress');
    }); // In the live case, we need to ignore the very first `seeking` event since
    // that will be the result of the seek-to-live behavior

    this.on(this.playlistController_, 'firstplay', function () {
      this.ignoreNextSeekingEvent_ = true;
    });
    this.setupQualityLevels_(); // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance

    if (!this.tech_.el()) {
      return;
    }

    this.mediaSourceUrl_ = window$1.URL.createObjectURL(this.playlistController_.mediaSource);
    this.tech_.src(this.mediaSourceUrl_);
  };

  _proto.createKeySessions_ = function createKeySessions_() {
    var _this4 = this;

    var audioPlaylistLoader = this.playlistController_.mediaTypes_.AUDIO.activePlaylistLoader;
    this.logger_('waiting for EME key session creation');
    waitForKeySessionCreation({
      player: this.player_,
      sourceKeySystems: this.source_.keySystems,
      audioMedia: audioPlaylistLoader && audioPlaylistLoader.media(),
      mainPlaylists: this.playlists.main.playlists
    }).then(function () {
      _this4.logger_('created EME key session');

      _this4.playlistController_.sourceUpdater_.initializedEme();
    }).catch(function (err) {
      _this4.logger_('error while creating EME key session', err);

      _this4.player_.error({
        message: 'Failed to initialize media keys for EME',
        code: 3,
        metadata: {
          errorType: videojs.Error.EMEKeySessionCreationError
        }
      });
    });
  };

  _proto.handleWaitingForKey_ = function handleWaitingForKey_() {
    // If waitingforkey is fired, it's possible that the data that's necessary to retrieve
    // the key is in the manifest. While this should've happened on initial source load, it
    // may happen again in live streams where the keys change, and the manifest info
    // reflects the update.
    //
    // Because videojs-contrib-eme compares the PSSH data we send to that of PSSH data it's
    // already requested keys for, we don't have to worry about this generating extraneous
    // requests.
    this.logger_('waitingforkey fired, attempting to create any new key sessions');
    this.createKeySessions_();
  }
  /**
   * If necessary and EME is available, sets up EME options and waits for key session
   * creation.
   *
   * This function also updates the source updater so taht it can be used, as for some
   * browsers, EME must be configured before content is appended (if appending unencrypted
   * content before encrypted content).
   */
  ;

  _proto.setupEme_ = function setupEme_() {
    var _this5 = this;

    var audioPlaylistLoader = this.playlistController_.mediaTypes_.AUDIO.activePlaylistLoader;
    var didSetupEmeOptions = setupEmeOptions({
      player: this.player_,
      sourceKeySystems: this.source_.keySystems,
      media: this.playlists.media(),
      audioMedia: audioPlaylistLoader && audioPlaylistLoader.media()
    });
    this.player_.tech_.on('keystatuschange', function (e) {
      _this5.playlistController_.updatePlaylistByKeyStatus(e.keyId, e.status);
    });
    this.handleWaitingForKey_ = this.handleWaitingForKey_.bind(this);
    this.player_.tech_.on('waitingforkey', this.handleWaitingForKey_);

    if (!didSetupEmeOptions) {
      // If EME options were not set up, we've done all we could to initialize EME.
      this.playlistController_.sourceUpdater_.initializedEme();
      return;
    }

    this.createKeySessions_();
  }
  /**
   * Initializes the quality levels and sets listeners to update them.
   *
   * @method setupQualityLevels_
   * @private
   */
  ;

  _proto.setupQualityLevels_ = function setupQualityLevels_() {
    var _this6 = this;

    var player = videojs.players[this.tech_.options_.playerId]; // if there isn't a player or there isn't a qualityLevels plugin
    // or qualityLevels_ listeners have already been setup, do nothing.

    if (!player || !player.qualityLevels || this.qualityLevels_) {
      return;
    }

    this.qualityLevels_ = player.qualityLevels();
    this.playlistController_.on('selectedinitialmedia', function () {
      handleVhsLoadedMetadata(_this6.qualityLevels_, _this6);
    });
    this.playlists.on('mediachange', function () {
      handleVhsMediaChange(_this6.qualityLevels_, _this6.playlists);
    });
  }
  /**
   * return the version
   */
  ;

  VhsHandler.version = function version$5() {
    return {
      '@videojs/http-streaming': version$4,
      'mux.js': version$3,
      'mpd-parser': version$2,
      'm3u8-parser': version$1,
      'aes-decrypter': version
    };
  }
  /**
   * return the version
   */
  ;

  _proto.version = function version() {
    return this.constructor.version();
  };

  _proto.canChangeType = function canChangeType() {
    return SourceUpdater.canChangeType();
  }
  /**
   * Begin playing the video.
   */
  ;

  _proto.play = function play() {
    this.playlistController_.play();
  }
  /**
   * a wrapper around the function in PlaylistController
   */
  ;

  _proto.setCurrentTime = function setCurrentTime(currentTime) {
    this.playlistController_.setCurrentTime(currentTime);
  }
  /**
   * a wrapper around the function in PlaylistController
   */
  ;

  _proto.duration = function duration() {
    return this.playlistController_.duration();
  }
  /**
   * a wrapper around the function in PlaylistController
   */
  ;

  _proto.seekable = function seekable() {
    return this.playlistController_.seekable();
  }
  /**
   * Abort all outstanding work and cleanup.
   */
  ;

  _proto.dispose = function dispose() {
    if (this.playbackWatcher_) {
      this.playbackWatcher_.dispose();
    }

    if (this.playlistController_) {
      this.playlistController_.dispose();
    }

    if (this.qualityLevels_) {
      this.qualityLevels_.dispose();
    }

    if (this.tech_ && this.tech_.vhs) {
      delete this.tech_.vhs;
    }

    if (this.mediaSourceUrl_ && window$1.URL.revokeObjectURL) {
      window$1.URL.revokeObjectURL(this.mediaSourceUrl_);
      this.mediaSourceUrl_ = null;
    }

    if (this.tech_) {
      this.tech_.off('waitingforkey', this.handleWaitingForKey_);
    }

    _Component.prototype.dispose.call(this);
  };

  _proto.convertToProgramTime = function convertToProgramTime(time, callback) {
    return getProgramTime({
      playlist: this.playlistController_.media(),
      time: time,
      callback: callback
    });
  } // the player must be playing before calling this
  ;

  _proto.seekToProgramTime = function seekToProgramTime$1(programTime, callback, pauseAfterSeek, retryCount) {
    if (pauseAfterSeek === void 0) {
      pauseAfterSeek = true;
    }

    if (retryCount === void 0) {
      retryCount = 2;
    }

    return seekToProgramTime({
      programTime: programTime,
      playlist: this.playlistController_.media(),
      retryCount: retryCount,
      pauseAfterSeek: pauseAfterSeek,
      seekTo: this.options_.seekTo,
      tech: this.options_.tech,
      callback: callback
    });
  }
  /**
   * Adds the onRequest, onResponse, offRequest and offResponse functions
   * to the VhsHandler xhr Object.
   */
  ;

  _proto.setupXhrHooks_ = function setupXhrHooks_() {
    var _this7 = this;

    /**
     * A player function for setting an onRequest hook
     *
     * @param {function} callback for request modifiction
     */
    this.xhr.onRequest = function (callback) {
      addOnRequestHook(_this7.xhr, callback);
    };
    /**
     * A player function for setting an onResponse hook
     *
     * @param {callback} callback for response data retrieval
     */


    this.xhr.onResponse = function (callback) {
      addOnResponseHook(_this7.xhr, callback);
    };
    /**
     * Deletes a player onRequest callback if it exists
     *
     * @param {function} callback to delete from the player set
     */


    this.xhr.offRequest = function (callback) {
      removeOnRequestHook(_this7.xhr, callback);
    };
    /**
     * Deletes a player onResponse callback if it exists
     *
     * @param {function} callback to delete from the player set
     */


    this.xhr.offResponse = function (callback) {
      removeOnResponseHook(_this7.xhr, callback);
    }; // Trigger an event on the player to notify the user that vhs is ready to set xhr hooks.
    // This allows hooks to be set before the source is set to vhs when handleSource is called.


    this.player_.trigger('xhr-hooks-ready');
  };

  return VhsHandler;
}(Component);
/**
 * The Source Handler object, which informs video.js what additional
 * MIME types are supported and sets up playback. It is registered
 * automatically to the appropriate tech based on the capabilities of
 * the browser it is running in. It is not necessary to use or modify
 * this object in normal usage.
 */


var VhsSourceHandler = {
  name: 'videojs-http-streaming',
  VERSION: version$4,
  canHandleSource: function canHandleSource(srcObj, options) {
    if (options === void 0) {
      options = {};
    }

    var localOptions = merge(videojs.options, options);
    return VhsSourceHandler.canPlayType(srcObj.type, localOptions);
  },
  handleSource: function handleSource(source, tech, options) {
    if (options === void 0) {
      options = {};
    }

    var localOptions = merge(videojs.options, options);
    tech.vhs = new VhsHandler(source, tech, localOptions);
    tech.vhs.xhr = xhrFactory();
    tech.vhs.setupXhrHooks_();
    tech.vhs.src(source.src, source.type);
    return tech.vhs;
  },
  canPlayType: function canPlayType(type, options) {
    var simpleType = simpleTypeFromSourceType(type);

    if (!simpleType) {
      return '';
    }

    var overrideNative = VhsSourceHandler.getOverrideNative(options);
    var supportsTypeNatively = Vhs.supportsTypeNatively(simpleType);
    var canUseMsePlayback = !supportsTypeNatively || overrideNative;
    return canUseMsePlayback ? 'maybe' : '';
  },
  getOverrideNative: function getOverrideNative(options) {
    if (options === void 0) {
      options = {};
    }

    var _options = options,
        _options$vhs = _options.vhs,
        vhs = _options$vhs === void 0 ? {} : _options$vhs;
    var defaultOverrideNative = !(videojs.browser.IS_ANY_SAFARI || videojs.browser.IS_IOS);
    var _vhs$overrideNative = vhs.overrideNative,
        overrideNative = _vhs$overrideNative === void 0 ? defaultOverrideNative : _vhs$overrideNative;
    return overrideNative;
  }
};
/**
 * Check to see if the native MediaSource object exists and supports
 * an MP4 container with both H.264 video and AAC-LC audio.
 *
 * @return {boolean} if  native media sources are supported
 */

var supportsNativeMediaSources = function supportsNativeMediaSources() {
  return browserSupportsCodec('avc1.4d400d,mp4a.40.2');
}; // register source handlers with the appropriate techs


if (supportsNativeMediaSources()) {
  videojs.getTech('Html5').registerSourceHandler(VhsSourceHandler, 0);
}

videojs.VhsHandler = VhsHandler;
videojs.VhsSourceHandler = VhsSourceHandler;
videojs.Vhs = Vhs;

if (!videojs.use) {
  videojs.registerComponent('Vhs', Vhs);
}

videojs.options.vhs = videojs.options.vhs || {};

if (!videojs.getPlugin || !videojs.getPlugin('reloadSourceOnError')) {
  videojs.registerPlugin('reloadSourceOnError', reloadSourceOnError);
}

export { LOCAL_STORAGE_KEY, Vhs, VhsHandler, VhsSourceHandler, emeKeySystems, expandDataUri, getAllPsshKeySystemsOptions, setupEmeOptions, waitForKeySessionCreation };
