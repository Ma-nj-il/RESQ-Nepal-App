/*
 * Browser-side runtime for the RESQ Nepal OpenStreetMap canvas.
 *
 * This file is inlined into a generated HTML module by
 * scripts/build-osm-map-html.mjs. It only requests tiles for the visible
 * viewport (plus Leaflet's small keepBuffer) and never preloads or stores a
 * map area. Attribution is rendered by the React Native overlay so it stays
 * above map overlays and remains tappable.
 */
(function () {
  'use strict';

  var TILE_URL = __RESQ_TILE_URL_JSON__;
  var MIN_ZOOM = 2;
  var MAX_ZOOM = 19;
  var DEFAULT_CENTER = [27.7172, 85.324];
  var DEFAULT_ZOOM = 13;

  var map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    preferCanvas: false,
    worldCopyJump: false,
  });

  var tiles = L.tileLayer(TILE_URL, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    tileSize: 256,
    keepBuffer: 1,
    updateWhenIdle: true,
    attribution: '&copy; OpenStreetMap contributors',
  });
  tiles.addTo(map);

  var zoomControls = document.getElementById('zoomControls');
  var markerLayers = { pickup: null, destination: null, current: null, ambulance: null };
  var hospitalLayers = [];
  var routeLine = null;
  var lastCameraKey = null;
  var hasCenteredOnAmbulance = false;
  var tileLoaded = false;
  var tileErrors = 0;

  function post(message) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    } catch (error) {
      // The bridge can disappear while the screen is being torn down.
    }
  }

  function asPoint(value) {
    if (!value) return null;
    var lat = Number(value.lat);
    var lng = Number(value.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  function postRegion() {
    var center = map.getCenter();
    post({
      type: 'region',
      latitude: center.lat,
      longitude: center.lng,
      zoom: map.getZoom(),
    });
  }

  function setInteractive(nextInteractive) {
    var interactive = Boolean(nextInteractive);
    ['dragging', 'touchZoom', 'doubleClickZoom'].forEach(function (handlerName) {
      var handler = map[handlerName];
      if (!handler) return;
      if (interactive) handler.enable();
      else handler.disable();
    });
    zoomControls.hidden = !interactive;
    zoomControls.setAttribute('aria-hidden', interactive ? 'false' : 'true');
  }

  function setMarker(name, label, className, point, title) {
    if (markerLayers[name]) {
      map.removeLayer(markerLayers[name]);
      markerLayers[name] = null;
    }
    if (!point) return;

    var icon = L.divIcon({
      className: 'resq-marker-icon',
      html:
        '<div class="resq-marker ' +
        className +
        '" aria-hidden="true">' +
        label +
        '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    var fallbackTitle =
      name === 'pickup' ? 'Pickup' : name === 'destination' ? 'Destination' : 'Your position';

    markerLayers[name] = L.marker([point.lat, point.lng], {
      icon: icon,
      interactive: false,
      keyboard: false,
      title: typeof title === 'string' && title ? title : fallbackTitle,
    }).addTo(map);
  }

  function applyState(state) {
    if (!state || typeof state !== 'object') return;

    setInteractive(state.interactive);

    var pickup = asPoint(state.pickup);
    var destination = asPoint(state.destination);
    var current = asPoint(state.current);
    var ambulance = asPoint(state.ambulance);
    var focus = asPoint(state.focus);
    var hospitals = Array.isArray(state.hospitals)
      ? state.hospitals
          .map(function (hospital) {
            var point = asPoint(hospital);
            return point
              ? { point: point, name: typeof hospital.name === 'string' ? hospital.name : 'Hospital' }
              : null;
          })
          .filter(Boolean)
      : [];
    var route = Array.isArray(state.route)
      ? state.route.map(asPoint).filter(Boolean)
      : [];

    hospitalLayers.forEach(function (layer) {
      map.removeLayer(layer);
    });
    hospitalLayers = hospitals.map(function (hospital) {
      var icon = L.divIcon({
        className: 'resq-marker-icon',
        html: '<div class="resq-marker resq-marker--hospital" aria-hidden="true">H</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      return L.marker([hospital.point.lat, hospital.point.lng], {
        icon: icon,
        interactive: false,
        keyboard: false,
        title: hospital.name,
      }).addTo(map);
    });

    setMarker('pickup', 'P', 'resq-marker--pickup', pickup, state.pickupLabel);
    setMarker('destination', 'D', 'resq-marker--destination', destination, state.destinationLabel);
    setMarker('current', '●', 'resq-marker--current', current, state.currentLabel);
    setMarker('ambulance', 'A', 'resq-marker--ambulance', ambulance, 'Assigned ambulance');

    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    if (route.length > 1) {
      routeLine = L.polyline(
        route.map(function (point) {
          return [point.lat, point.lng];
        }),
        {
          color: '#E53935',
          weight: 5,
          opacity: 0.9,
          interactive: false,
        },
      ).addTo(map);
    }

    var cameraKey = JSON.stringify({ pickup: pickup, destination: destination, focus: focus });
    var selectionChanged = cameraKey !== lastCameraKey;
    var firstAmbulanceFix = Boolean(ambulance) && !hasCenteredOnAmbulance;
    if (selectionChanged) {
      lastCameraKey = cameraKey;
      hasCenteredOnAmbulance = Boolean(ambulance);
    } else if (firstAmbulanceFix) {
      hasCenteredOnAmbulance = true;
    }

    var points = [pickup, destination, current, ambulance, focus]
      .filter(Boolean)
      .map(function (point) {
        return [point.lat, point.lng];
      });
    if (route.length > 1) {
      route.forEach(function (point) {
        points.push([point.lat, point.lng]);
      });
    }

    if ((selectionChanged || firstAmbulanceFix) && points.length > 1) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [36, 36],
        maxZoom: 16,
        animate: true,
      });
    } else if ((selectionChanged || firstAmbulanceFix) && points.length === 1) {
      map.setView(points[0], 14, { animate: true });
    }

    // The WebView can settle after Leaflet's first measurement (rotation,
    // keyboard, safe-area changes), so re-measure after the state update.
    window.setTimeout(function () {
      map.invalidateSize();
    }, 0);
  }

  tiles.on('tileload', function () {
    if (tileLoaded) return;
    tileLoaded = true;
    post({ type: 'tile-ready' });
  });

  tiles.on('tileerror', function () {
    tileErrors += 1;
    if (!tileLoaded && tileErrors >= 2) {
      post({ type: 'tile-error' });
    }
  });

  map.on('moveend', postRegion);

  document.getElementById('zoomIn').addEventListener('click', function () {
    map.zoomIn();
  });
  document.getElementById('zoomOut').addEventListener('click', function () {
    map.zoomOut();
  });

  window.addEventListener('resize', function () {
    map.invalidateSize();
  });

  window.__resqSetState = applyState;

  map.whenReady(function () {
    window.setTimeout(function () {
      map.invalidateSize();
      post({ type: 'map-ready' });
      postRegion();
    }, 0);
  });
})();
