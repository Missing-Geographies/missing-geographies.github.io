/* ============================================================
   mobile-fixes.js
   Touch and phone behaviour patches. Additive only: it does not
   modify or re-run anything in script.js, it only adds listeners.
   Safe to delete.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------------
     1. Pinch to zoom the globe.
     Zoom was bound to the wheel event only, and touch-action:none on
     a full-screen globe also suppresses the browser own pinch, so a
     phone had no way to zoom at all. This reuses the existing global
     zoomGlobe() step function rather than touching the projection.
     --------------------------------------------------------------- */
  function addPinchZoom() {
    var globe = document.getElementById("globe");

    if (!globe || globe.getAttribute("data-mg-pinch") === "1") return;
    globe.setAttribute("data-mg-pinch", "1");

    var startDistance = 0;
    var lastRatio = 1;

    function spread(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    globe.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 2) return;
      startDistance = spread(event.touches);
      lastRatio = 1;
    }, { passive: true });

    globe.addEventListener("touchmove", function (event) {
      if (event.touches.length !== 2) return;
      if (!startDistance) return;
      if (typeof window.zoomGlobe !== "function") return;

      event.preventDefault();

      var ratio = spread(event.touches) / startDistance;
      var steps = Math.round(Math.log(ratio / lastRatio) / Math.log(1.06));

      if (!steps) return;

      var direction = steps > 0 ? "in" : "out";
      var count = Math.min(Math.abs(steps), 6);
      var i;

      for (i = 0; i < count; i++) window.zoomGlobe(direction);

      lastRatio = ratio;
    }, { passive: false });

    globe.addEventListener("touchend", function (event) {
      if (event.touches.length < 2) startDistance = 0;
    }, { passive: true });

    globe.addEventListener("touchcancel", function () {
      startDistance = 0;
    }, { passive: true });
  }

  /* ---------------------------------------------------------------
     2. The invitation letter behind the blinking dot, on touch.
     styles.css hides that letter with opacity and visibility only,
     so the box keeps a real rectangle under the title, and script.js
     opens the letter whenever a pointer moves inside that rectangle
     (isPointNearRect against the quote box). On a phone the invisible
     rectangle covers most of the upper screen, so almost any touch,
     or a drag across the globe, popped the letter open.

     mobile-fixes.css collapses the hidden box on touch devices, which
     removes the phantom trigger area. These two additions are the part
     CSS cannot do: a finger-sized target on the dot, and a way out of
     the letter once it is open.
     --------------------------------------------------------------- */
  function addTitleQuoteTouchFix() {
    if (!window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

    var marker = document.querySelector(".title-live-i");
    var quote = document.getElementById("title-memory-quote");

    /* A child, so the rectangle script.js measures for its 24px
       proximity test is unchanged. It paints nothing. */
    if (marker && !marker.querySelector(".mg-i-hit")) {
      var hit = document.createElement("span");

      hit.className = "mg-i-hit";
      hit.setAttribute("aria-hidden", "true");
      marker.appendChild(hit);
    }

    if (quote && !quote.querySelector(".mg-quote-close")) {
      var close = document.createElement("button");

      close.type = "button";
      close.className = "mg-quote-close";
      close.setAttribute("aria-label", "Close the invitation");
      close.textContent = "\u00d7";

      /* Click the dot instead of stripping the class directly, so the
         open/closed flag inside script.js stays in step with the DOM. */
      close.addEventListener("click", function (event) {
        event.stopPropagation();

        var dot = document.querySelector(".title-live-i");

        if (dot) dot.click();
      });

      quote.appendChild(close);
    }
  }

  /* ---------------------------------------------------------------
     3. Audio that never starts on a phone.
     The recordings are served from storage.tally.so, and that reply
     carries no Content-Length and no Accept-Ranges: unknown length,
     byte ranges refused. A laptop shrugs at that and reads the
     stream to the end, which is why the dock plays there. iOS will
     not start a media element it can neither measure nor seek, so
     the control strip reads "Live Broadcast", the counter sits at
     0:00 / 0:00, and the play button does nothing however directly
     it is tapped. The note in the call panel is asking for something
     that was never going to help.

     Fetch the file with a plain request instead and hand the element
     a blob URL: local, measurable, seekable, and labelled with a
     type iOS accepts (x-m4a and bare aac are the same MP4 audio, but
     only audio/mp4 is recognised everywhere). The scrubber and the
     subtitle ticker both read currentTime, so they come back with it.

     The download starts as soon as a story sets a source, which is
     at selection, so the file is usually ready before the journey
     ends and the first tap plays at once. A tap that lands during
     the download is remembered and honoured when the last byte
     arrives.

     script.js is not modified: this watches the audio elements it
     already builds, and only on a touch pointer, so the desktop
     path that works today is left alone.
     --------------------------------------------------------------- */
  var AUDIO_HELP_TEXT = "On mobile, audio needs a direct tap.";
  var AUDIO_LOADING_TEXT = "Loading this recording\u2026";
  var AUDIO_BLOB_KEEP = 3;
  var audioBlobStore = {};
  var audioBlobOrder = [];

  function isTouchPointer() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia("(hover: none), (pointer: coarse)").matches
    );
  }

  function isRemoteSource(value) {
    var text = String(value || "").toLowerCase();

    return text.indexOf("http://") === 0 || text.indexOf("https://") === 0;
  }

  /* The extension is the more trustworthy of the two signals here:
     Tally labels m4a files audio/x-m4a, which older WebKit refuses. */
  function audioMimeFor(url, declaredType) {
    var declared = String(declaredType || "").split(";")[0].trim().toLowerCase();
    var path = String(url || "").split("?")[0].split("#")[0];
    var extension = (path.split(".").pop() || "").toLowerCase();
    var byExtension = {
      m4a: "audio/mp4",
      m4b: "audio/mp4",
      mp4: "audio/mp4",
      aac: "audio/mp4",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      oga: "audio/ogg",
      opus: "audio/ogg",
      webm: "audio/webm",
      flac: "audio/flac"
    };
    var mp4Labels = [
      "audio/x-m4a",
      "audio/m4a",
      "audio/aac",
      "audio/x-aac",
      "audio/mp4a-latm"
    ];

    if (byExtension[extension]) return byExtension[extension];
    if (mp4Labels.indexOf(declared) !== -1) return "audio/mp4";
    if (declared.indexOf("audio/") === 0) return declared;

    return "audio/mpeg";
  }

  function tellAudioWatchers(record, ratio) {
    record.watchers.forEach(function (watcher) {
      try {
        watcher(ratio);
      } catch (error) {}
    });
  }

  function forgetAudioBlob(url) {
    var record = audioBlobStore[url];
    var at = audioBlobOrder.indexOf(url);

    delete audioBlobStore[url];

    if (at !== -1) audioBlobOrder.splice(at, 1);

    return record;
  }

  function audioBlobStillOnPage(blobUrl) {
    var players = document.querySelectorAll("audio, video");
    var i;

    for (i = 0; i < players.length; i++) {
      if (players[i].src === blobUrl || players[i].currentSrc === blobUrl) {
        return true;
      }
    }

    return false;
  }

  /* Recordings run to several megabytes, so keep only a few. */
  function trimAudioBlobStore() {
    while (audioBlobOrder.length > AUDIO_BLOB_KEEP) {
      var record = forgetAudioBlob(audioBlobOrder[0]);

      if (record && record.blobUrl && !audioBlobStillOnPage(record.blobUrl)) {
        URL.revokeObjectURL(record.blobUrl);
      }
    }
  }

  function readAudioBody(response, record, url) {
    var mime = audioMimeFor(url, response.headers.get("content-type"));

    /* A missing length is the condition this exists for, so progress
       is measured against a rough guess when there is none. */
    var span = Number(response.headers.get("content-length")) || 6 * 1024 * 1024;

    if (!response.body || typeof response.body.getReader !== "function") {
      return response.blob().then(function (whole) {
        tellAudioWatchers(record, 1);

        return URL.createObjectURL(new Blob([whole], { type: mime }));
      });
    }

    var reader = response.body.getReader();
    var pieces = [];
    var read = 0;

    function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          tellAudioWatchers(record, 1);

          return URL.createObjectURL(new Blob(pieces, { type: mime }));
        }

        pieces.push(step.value);
        read += step.value.length;
        tellAudioWatchers(record, Math.min(0.99, read / span));

        return pump();
      });
    }

    return pump();
  }

  function loadAudioBlob(url, onProgress) {
    var record = audioBlobStore[url];

    if (!record) {
      record = { blobUrl: "", watchers: [], promise: null };
      audioBlobStore[url] = record;
      audioBlobOrder.push(url);
      trimAudioBlobStore();

      record.promise = fetch(url, { credentials: "omit" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);

          return readAudioBody(response, record, url);
        })
        .then(function (blobUrl) {
          record.blobUrl = blobUrl;
          record.watchers.length = 0;

          return blobUrl;
        })
        .catch(function (error) {
          /* Drop the record so a later tap can try again. */
          forgetAudioBlob(url);

          throw error;
        });
    }

    if (onProgress) {
      if (record.blobUrl) onProgress(1);
      else record.watchers.push(onProgress);
    }

    return record.promise;
  }

  /* The call panel keeps a line of help text under the player. It is
     the only place on a phone where this can say anything. */
  function sayUnderPlayer(element, message) {
    var room = element.closest
      ? element.closest(".mg-mobile-native-audio-room")
      : null;
    var help = room ? room.querySelector(".mg-mobile-native-audio-help") : null;

    if (help) help.textContent = message;
  }

  /* Sound actually coming out, as opposed to a stalled element that
     reports itself unpaused while it waits for data that never
     arrives. Swapping the source under real playback would restart
     it, so that case is left alone. */
  function isReallyPlaying(element) {
    return Boolean(
      !element.paused &&
      element.readyState >= 3 &&
      element.currentTime > 0.15 &&
      isFinite(element.duration) &&
      element.duration > 0
    );
  }

  /* An element that reports itself unpaused while muted at zero
     volume is not playing anything. That is the silent unlock play
     script.js makes inside the original tap, so that real playback
     is allowed later on. Reading it as an instruction would start
     the story the moment it is chosen, half a minute before the call
     arrives. Only audible playback, or a tap on a player, counts. */
  function wantsSound(element) {
    if (element.dataset.mgAudioWanted === "1") return true;

    return Boolean(!element.paused && !element.muted && element.volume > 0);
  }

  function applyAudioBlob(element, remote, blobUrl, shouldPlay) {
    if (element.getAttribute("src") === blobUrl) return;

    element.dataset.mgAudioRemote = remote;
    element.src = blobUrl;

    try {
      element.load();
    } catch (error) {}

    if (!shouldPlay) {
      sayUnderPlayer(element, "Ready. Tap play.");
      return;
    }

    element.dataset.mgAudioWanted = "0";
    sayUnderPlayer(element, AUDIO_HELP_TEXT);

    var attempt = element.play();

    /* If the tap that asked for this is too old to count as a
       gesture any more, the second one lands on a loaded file. */
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(function () {
        sayUnderPlayer(element, "Ready. Tap play.");
      });
    }
  }

  function useAudioBlobSource(element) {
    var remote = element.getAttribute("src") || "";

    if (!isRemoteSource(remote)) return;

    var record = audioBlobStore[remote];
    var wanted = wantsSound(element);

    /* Already downloaded. script.js writes the remote URL back onto
       the player every time it reopens a panel, so this is the
       common path rather than the exception. */
    if (record && record.blobUrl) {
      applyAudioBlob(element, remote, record.blobUrl, wanted);
      return;
    }

    if (element.dataset.mgAudioLoading === remote) return;

    element.dataset.mgAudioLoading = remote;
    sayUnderPlayer(element, AUDIO_LOADING_TEXT);

    loadAudioBlob(remote, function (ratio) {
      if (element.dataset.mgAudioLoading !== remote) return;

      sayUnderPlayer(
        element,
        AUDIO_LOADING_TEXT + " " + Math.round(ratio * 100) + "%"
      );
    }).then(function (blobUrl) {
      var stillWanted = wantsSound(element);

      delete element.dataset.mgAudioLoading;

      /* The listener may have moved to another call meanwhile. */
      if ((element.getAttribute("src") || "") !== remote) return;

      applyAudioBlob(element, remote, blobUrl, stillWanted);
    }).catch(function () {
      delete element.dataset.mgAudioLoading;
      sayUnderPlayer(
        element,
        "This recording would not load. Open audio file still works."
      );
    });
  }

  /* On a slow connection script.js parks the URL here and strips the
     source, so warm the file up from the parked copy too. */
  function prefetchParkedAudio(element) {
    var parked = element.getAttribute("data-mg-pending-audio") || "";

    if (!isRemoteSource(parked)) return;

    loadAudioBlob(parked).catch(function () {});
  }

  function considerAudioElement(element) {
    if (!element || element.tagName !== "AUDIO") return;

    prefetchParkedAudio(element);

    if (isReallyPlaying(element)) return;

    useAudioBlobSource(element);
  }

  function noteAudioWanted(event) {
    var element = event.target;

    if (!element || element.tagName !== "AUDIO") return;
    if (event.type === "play" && (element.muted || !element.volume)) return;

    element.dataset.mgAudioWanted = "1";
  }

  function addPhoneAudioFix() {
    if (!isTouchPointer()) return;

    var root = document.documentElement;

    if (root.getAttribute("data-mg-audio-blob") === "1") return;

    root.setAttribute("data-mg-audio-blob", "1");

    var players = document.querySelectorAll("audio");
    var i;

    for (i = 0; i < players.length; i++) considerAudioElement(players[i]);

    var observer = new MutationObserver(function (records) {
      var r;
      var n;
      var k;

      for (r = 0; r < records.length; r++) {
        var record = records[r];

        if (record.type === "attributes") {
          considerAudioElement(record.target);
          continue;
        }

        for (n = 0; n < record.addedNodes.length; n++) {
          var node = record.addedNodes[n];

          if (!node || node.nodeType !== 1) continue;

          considerAudioElement(node);

          if (!node.querySelectorAll) continue;

          var inside = node.querySelectorAll("audio");

          for (k = 0; k < inside.length; k++) considerAudioElement(inside[k]);
        }
      }
    });

    /* The call panel and its player are built after arrival, so watch
       for the element as well as for source changes on it. */
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "data-mg-pending-audio"]
    });

    /* A tap on the native play button of a file that is still coming
       down is an instruction, not a mistake. Remember it. */
    document.addEventListener("play", noteAudioWanted, true);
    document.addEventListener("pointerdown", noteAudioWanted, true);
  }

  /* ---------------------------------------------------------------
     4. When the audio starts, and the bar that asked for a tap.

     script.js routes playback away from its own chain on a phone.
     Three separate patches intercept playStoryAudio, and the last of
     them parks the story until the journey ends, then shows a panel
     with a native player and "Tap play to hear this call". All three
     were written for one reason, that iOS could not play a stream it
     cannot measure or seek, and section 3 removed that reason.

     What is left is their side effects. Timing: the desktop chain
     starts the recording from inside the journey, at the moment the
     line reaches the city and the waiting beep stops, and nothing on
     a phone was reaching that code, so the only playback was
     whatever the panel was tapped into. Subtitles: that same chain
     is what calls startMapSubtitles, so on a phone the overlay was
     never armed and no cue could appear.

     One cure for all of it: let the phone run the chain the computer
     runs. Each of the three interceptions asks the device what it is
     at the moment it decides, so the device answers as a computer
     for the length of that one synchronous call and all three step
     aside. Nothing is patched out and nothing is re-implemented
     here, so the timing is not an imitation of the desktop timing,
     it is the same call site in the same code.

     If playback really is refused, the panel is still the way out:
     the chain is called again untouched a few seconds later, which
     brings it back exactly as it was.
     --------------------------------------------------------------- */
  var DESKTOP_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  var audioStartToken = 0;

  function fakeMediaQuery(query, matches) {
    return {
      matches: matches,
      media: query,
      onchange: null,
      addListener: function () {},
      removeListener: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () {
        return false;
      }
    };
  }

  /* The touch tests in script.js are navigator.userAgent,
     navigator.platform with maxTouchPoints, and the hover and
     pointer media queries. All four answer as a desktop for the
     duration of run(), and are put back in a finally so a throw
     cannot leave the page lying about itself. */
  function asDesktopEnvironment(run) {
    var realMatchMedia = window.matchMedia;
    var pretend = {
      userAgent: DESKTOP_USER_AGENT,
      platform: "Win32",
      maxTouchPoints: 0
    };
    var names = Object.keys(pretend);

    names.forEach(function (name) {
      try {
        Object.defineProperty(navigator, name, {
          configurable: true,
          get: function () {
            return pretend[name];
          }
        });
      } catch (error) {}
    });

    if (typeof realMatchMedia === "function") {
      window.matchMedia = function (query) {
        var text = String(query).toLowerCase();
        var touchQuestion =
          text.indexOf("hover: none") !== -1 ||
          text.indexOf("pointer: coarse") !== -1;
        var mouseQuestion =
          text.indexOf("hover: hover") !== -1 ||
          text.indexOf("pointer: fine") !== -1;

        if (touchQuestion) return fakeMediaQuery(query, false);
        if (mouseQuestion) return fakeMediaQuery(query, true);

        return realMatchMedia.call(window, query);
      };
    }

    try {
      return run();
    } finally {
      window.matchMedia = realMatchMedia;

      /* navigator keeps these on its prototype, so dropping the
         copies made above puts the real answers back. */
      names.forEach(function (name) {
        try {
          delete navigator[name];
        } catch (error) {}
      });
    }
  }

  function audioIsStillDownloading(remote) {
    var record = audioBlobStore[remote];

    return Boolean(record && !record.blobUrl);
  }

  /* Last resort. Sound refused for a reason not thought of here, no
     story change since, and nothing left to download: hand the call
     back to the untouched chain, which shows the old panel. */
  function rescueIfNothingPlays(story, token, runUntouched) {
    var element = document.getElementById("story-audio");
    var remote = String((story && story.audio) || "");
    var quiet = 0;

    if (!element) return;

    var timer = window.setInterval(function () {
      if (token !== audioStartToken || element.currentTime > 0.2) {
        window.clearInterval(timer);
        return;
      }

      if (audioIsStillDownloading(remote)) return;

      quiet += 1;

      if (quiet < 9) return;

      window.clearInterval(timer);

      if (element.paused || element.readyState === 0) runUntouched();
    }, 500);
  }

  function addDesktopAudioTiming() {
    if (!isTouchPointer()) return;
    if (typeof window.playStoryAudio !== "function") return;

    /* Re-wrap if a later patch has since taken the outer position. */
    if (window.playStoryAudio.mgPhoneTimed) return;

    var chained = window.playStoryAudio;

    function phoneAudioFollowsDesktop(story) {
      var self = this;
      var args = arguments;

      audioStartToken += 1;

      var token = audioStartToken;
      var result = asDesktopEnvironment(function () {
        return chained.apply(self, args);
      });

      rescueIfNothingPlays(story, token, function () {
        chained.apply(self, args);
      });

      return result;
    }

    phoneAudioFollowsDesktop.mgPhoneTimed = true;
    window.playStoryAudio = phoneAudioFollowsDesktop;
  }

  function init() {
    addPinchZoom();
    addTitleQuoteTouchFix();
    addPhoneAudioFix();
    addDesktopAudioTiming();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* script.js builds the title dot and the letter after the sheet
     loads, so run again as the dust settles. init() is idempotent. */
  [1500, 3000, 6000].forEach(function (ms) {
    window.setTimeout(init, ms);
  });
})();
