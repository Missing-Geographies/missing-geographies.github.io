/* ============================================================
   mobile-fixes.js
   Touch and phone behaviour patches. Additive only: it does not
   modify or re-run anything in script.js, it only adds listeners
   and one nav button. Safe to delete.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------------
     1. A clearly labelled way into the call archive on phones.
     Below 760px the story panel is folded into a 38px summary that
     reads "Iran / ایران", which nobody reads as "list of stories".
     This adds a plain "Stories" button next to it that toggles the
     same <details> element, so there is one obvious entry point.
     --------------------------------------------------------------- */
  function addStoriesOpener() {
    var dropdown = document.querySelector("details.call-room-dropdown");
    var actions = document.querySelector(".project-nav-actions");

    if (!dropdown || !actions) return;
    if (document.querySelector(".mg-mobile-stories-button")) return;

    var button = document.createElement("button");

    button.type = "button";
    button.className = "mg-mobile-stories-button";
    button.textContent = "Stories";
    button.setAttribute("aria-label", "Open the call archive");
    button.setAttribute("aria-expanded", dropdown.open ? "true" : "false");

    button.addEventListener("click", function () {
      dropdown.open = !dropdown.open;
    });

    dropdown.addEventListener("toggle", function () {
      button.setAttribute("aria-expanded", dropdown.open ? "true" : "false");
    });

    actions.insertBefore(button, actions.firstChild);
  }

  /* ---------------------------------------------------------------
     2. Pinch to zoom the globe.
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

  function init() {
    addStoriesOpener();
    addPinchZoom();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* script.js rebuilds parts of the nav after the sheet loads, so run
     once more when the dust has settled. init() is idempotent. */
  window.setTimeout(init, 3000);
})();
