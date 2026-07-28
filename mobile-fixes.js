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

  function init() {
    addPinchZoom();
    addTitleQuoteTouchFix();
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
