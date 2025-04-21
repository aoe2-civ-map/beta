document.addEventListener('DOMContentLoaded', () => {
  // CONFIG
  const META_PATH      = 'data/meta_data.json';
  const DEF_OPACITY    = 0.7;
  const SLIDER_MIN     = 0;
  const SLIDER_MAX     = 1700;
  const SLIDER_STEP    = 10;
  const MINOR_TICK     = 100;
  const MAJOR_TICK     = 500;
  // Minimum and maximum icon size relative to zoom level
  const MIN_ICON_SCALE = 0.25;  // Minimum icon size in pixels
  const MAX_ICON_SCALE = 1;     // Maximum icon size in pixels

  // STATE
  let map;
  let meta;               // holds entire meta_data.json
  let civs = [];          // meta.civilisations
  const layersByCiv = {}; // tracks Leaflet layers by civilisation
  const icons = {};
  let playActive  = false;
  let playTimer   = null;
  const svgCache = {};    // key: `${symbol}_${color}`, value: processed SVG string
  let wonderPositions = null;

  // Init Map
  function initMap() {
    map = L.map('map').setView([60, 8], 3);

    // dedicated pane for emblems with a very high z‑index
    map.createPane('emblems');
    map.getPane('emblems').style.zIndex = 700;            // above default markerPane (600) and overlayPane (400) #FIXME doesnt work
    map.getPane('emblems').style.pointerEvents = 'none';  // so clicks pass through

    // define all base‑layers
    const baseLayers = {
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }),
      otopo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap (CC‑BY‑SA)',
        maxZoom: 17
      }),
      // stamenTerrain: L.tileLayer(
      //   'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg',
      //   {
      //     attribution:
      //       'Map tiles by <a href="http://stamen.com">Stamen Design</a>, ' +
      //       'CC BY 3.0 — Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      //     subdomains: 'abcd',
      //     minZoom: 0,
      //     maxZoom: 18
      //   }
      // ),
      // stamenTerrainLabels: L.tileLayer(
      //   'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain-labels/{z}/{x}/{y}.png',
      //   {
      //     attribution:
      //       'Map labels by <a href="http://stamen.com">Stamen Design</a>, ' +
      //       'CC BY 3.0',
      //     subdomains: 'abcd',
      //     minZoom: 0,
      //     maxZoom: 18
      //   }
      // ),
      // stamenTerrainBg: L.tileLayer(
      //   'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain-background/{z}/{x}/{y}.png',
      //   {
      //     attribution:
      //       'Map tiles by <a href="http://stamen.com">Stamen Design</a>, ' +
      //       'CC BY 3.0 — Hillshade only',
      //     subdomains: 'abcd',
      //     minZoom: 0,
      //     maxZoom: 14
      //   }
      // ),
      topo: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles © Esri — World Topo Map' }
      ),
      terrain: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 15, attribution: 'Tiles © Esri — World Terrain Base' }
      ),
      // hillshade: L.tileLayer(
      //   'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      //   { maxZoom: 13, attribution: 'Tiles © Esri — World Hillshade' }
      // ),
      natgeo: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, attribution: 'Tiles © Esri & National Geographic' }
      ),
      imagery: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
      )
    };
    
    L.control.layers({
      'OSM Streets': baseLayers.osm,
      'OpenTopoMap': baseLayers.otopo,
      // 'StamenT': baseLayers.stamenTerrain,
      // 'StamenTL': baseLayers.stamenTerrainLabels,
      // 'StamenTBG': baseLayers.stamenTerrainBg,
      'Topo Map': baseLayers.topo,
      'Terrain Base': baseLayers.terrain,
      // 'Hillshade Only': baseLayers.hillshade,
      'NatGeo Topo': baseLayers.natgeo,
      'Imagery': baseLayers.imagery
    }).addTo(map);

    // default choice
    baseLayers.terrain.addTo(map);

    // HTML <select> linkage
    document.getElementById('basemap-select').addEventListener('change', e => {
      const choice = e.target.value;
      // remove any that are currently on the map
      Object.values(baseLayers).forEach(l => map.hasLayer(l) && map.removeLayer(l));
      // add the newly selected one
      baseLayers[choice].addTo(map);
    });
  }


  // Grid Toggle
  function initGridToggle() {
    const group = L.layerGroup().addTo(map);
    document.getElementById('toggle-grid').addEventListener('change', ({ target }) => {
      group.clearLayers();
      if (!target.checked) return;
      for (let lat=-80; lat<=80; lat+=10) {
        L.polyline([[lat,-180],[lat,180]], { color:'#666', weight:0.5, opacity:0.6, dashArray:'4,4' })
          .addTo(group);
      }
      for (let lng=-180; lng<=180; lng+=10) {
        L.polyline([[-90,lng],[90,lng]], { color:'#666', weight:0.5, opacity:0.6, dashArray:'4,4' })
          .addTo(group);
      }
    });
  }

  // Load and parse meta_data.json
  async function loadMetaData() {
    const resp = await fetch(META_PATH);
    meta = await resp.json();
    civs = meta.civilisations;
    civs.forEach(c=> layersByCiv[c.name]=[]);
    Object.entries(meta.symbols||{}).forEach(([k,cfg]) => {
      icons[k] = L.icon(cfg);
    });
  }

  // load wonder_pos.json once
  async function loadWonderPositions() {
    if (!wonderPositions) {
      wonderPositions = await fetch('data/wonder_pos.json')
        .then(r => r.json());
    }
    return wonderPositions;
  }

  // Load general svg icon and replace fills with currentColor
  async function loadSvgIconContent(url) {
    const res = await fetch(url);
    const svgText = await res.text();
    return svgText.replace(/fill="[#\w\d]+"/g, 'fill="currentColor"');
  }

  // Function to adjust the icon size based on the zoom level
  function adjustIconSize(map) {
    const zoomLevel   = map.getZoom();  // Get the current zoom level in [1,18] where 18 is the closest
    // Define a scaling factor (this is arbitrary and can be adjusted as needed)
    // const scaleFactor = 2;
    // Calculate the icon size based on zoom level
    // let newSize = Math.max(MIN_ICON_SIZE, Math.min(MAX_ICON_SIZE, zoomLevel * scaleFactor));
    // min(-6*abs(x-9)+10*6,24)
    let newSize = Math.min(10*MIN_ICON_SCALE-MIN_ICON_SCALE*Math.abs(zoomLevel-9),MAX_ICON_SCALE);

    return newSize;
  }

  // https://stackoverflow.com/questions/196972/convert-string-to-title-case-with-javascript
  String.prototype.toTitleCase = function () {
    return this.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
  };

  // Slider Setup
  function initSlider(onUpdate) {
    const slider = document.getElementById('year-slider');
    noUiSlider.create(slider, {
      start: SLIDER_MIN,
      step: SLIDER_STEP,
      range: { min: SLIDER_MIN, max: SLIDER_MAX },
      connect: 'lower',             // colored bar
      // connect: false,             // no colored bar
      pips: {
        mode:   'values',
        values: Array.from({ length:(SLIDER_MAX-SLIDER_MIN)/MINOR_TICK+1 },
                           (_,i)=>SLIDER_MIN+i*MINOR_TICK),
        density: 4,
        format: { to:v=> v%MAJOR_TICK===0?`${v} AD`:'', from:v=>parseInt(v) }
      }
    });
    slider.noUiSlider.on('update', v=> onUpdate(parseInt(v[0])));
    return slider;
  }

  // Play/Pause Logic
  // START the animation loop
  async function startPlay(slider) {
    if (playActive) return;
    playActive = true;
    document.getElementById('play-pause').textContent = 'Pause';

    const speed = parseInt(
      document.getElementById('speed-select').value,
      10
    );

    // Grab the current year correctly
    let year = parseInt(slider.noUiSlider.get(), 10);

    // Loop until we hit the max or the user pauses
    while (playActive && year < SLIDER_MAX) {
      year = Math.min(year + SLIDER_STEP, SLIDER_MAX);
      slider.noUiSlider.set(year);
      // wait for “speed” ms before next tick
      await new Promise(r => setTimeout(r, speed));
    }

    // Once done (or paused), reset button
    stopPlay();
  }

  // STOP the animation loop
  function stopPlay() {
    playActive = false;
    document.getElementById('play-pause').textContent = 'Play';
    // no need to clear here because our loop checks playActive
  }

  // Turn a title like "123" or "123-345" into [start,end]
  /**
   * Given a title string like "123" or "123-345", return [start, end].
   * Missing or empty titles → full span [SLIDER_MIN, SLIDER_MAX].
   */
  function parseSpan(title) {
    if (typeof title!=='string' || !title.trim()) return [SLIDER_MIN, SLIDER_MAX];
    const parts = title.split('-').map(s=>parseInt(s,10)).filter(n=>!isNaN(n));
    if (parts.length===2) return parts;
    if (parts.length===1) return [parts[0],SLIDER_MAX];
    return [SLIDER_MIN,SLIDER_MAX];
  }

  
  // Create a tiny data wrapper for filtering & styling
  /**
   * Pulls out geometry & properties, applies defaults,
   * then parses the time span & style info.
   */
  function wrapFeature(feat,civ) {
    // Always pull from feat.geometry and feat.properties
    const geom = feat.geometry;
    const props = feat.properties || {};

    // Safely parse the time span
    const [start,end]=parseSpan(props.title);
    // Map stroke-width → opacity, defaulting to DEF_OPACITY
    const sw=parseFloat(props['stroke-width']);
    const opacity=!isNaN(sw)?sw/10:DEF_OPACITY;
    return { geom, props, start, end, color:civ.color, opacity };
  }

  // Remove all existing civ layers
  function clearAllLayers() {
    civs.forEach(civ=>{
      layersByCiv[civ.name].forEach(l=>map.removeLayer(l));
      layersByCiv[civ.name]=[];
    });
  }
  /* 
  function colorizeIcon(iconUrl, color) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous'; // Ensure cross-origin compatibility
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
  
        // Draw the original image
        ctx.drawImage(img, 0, 0);
  
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
  
        // Replace black pixels with the desired color
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = data.slice(i, i + 4);
          if (r === 0 && g === 0 && b === 0 && a > 0) { // Black pixels
            data[i] = parseInt(color.slice(1, 3), 16); // Red
            data[i + 1] = parseInt(color.slice(3, 5), 16); // Green
            data[i + 2] = parseInt(color.slice(5, 7), 16); // Blue
          }
        }
  
        // Put the modified image data back
        ctx.putImageData(imageData, 0, 0);
  
        // Resolve with the new image URL
        resolve(canvas.toDataURL());
      };
      img.src = iconUrl;
    });
  }
 */
  // Render all features for the given year
  async function render(year) {
    document.getElementById('year-display').textContent = `Year: ${year} AD`;
    clearAllLayers();
    await Promise.all(
      civs.map(async civ => {
        // lazy‐load GeoJSON
        if (!civ._data) civ._data = await fetch(`data/${civ.file}`).then(r => r.json());
        civ._data.features.forEach(async f => {
        // for (const f of civ._data.features) {
          const { geom, props, start, end, color, opacity } = wrapFeature(f, civ);
          if (year < start || year > end) return;
          let layer;
          if (geom.type === 'Point') {
            layer = await renderPoint(geom, props, color, opacity, civ);
          } else if (geom.type === 'LineString') {
            layer = await renderLineString(geom, color, opacity);
          } else if (geom.type === 'Polygon') {
            layer = await renderPolygon(geom, color, opacity);
          }
          if (layer) {
            props.description && layer.bindPopup(props.description);
            layer.addTo(map);
            layersByCiv[civ.name.toLowerCase()].push(layer);
          }
        // }
        });
      })
    );

    // draw the civilization emblems
    await renderEmblems();
  }

  // Render a point feature// Render a point feature
  async function renderPoint(geom, props, color, opacity, civ) {
    const lat = geom.coordinates[1];
    const lng = geom.coordinates[0];

    // compute scale once
    const iconScale = adjustIconSize(map);

    // // handle "information" → emblem PNG from emblems/
    // if (props['marker-symbol'] === 'information') {
    //   // pull emblem drawing options
    //   const { iconUrl: emblemBase, iconSize, iconAnchor } = icons['emblem'].options;

    //   // build the actual file name from civ.name
    //   const fileName = `${civ.name.replace(/\s+/g, '_').toTitleCase()}_AoE2.png`;
    //   // ensure slash
    //   const emblemUrl = emblemBase.endsWith('/')
    //     ? emblemBase + fileName
    //     : emblemBase + '/' + fileName;

    //   // scale size & anchor
    //   const scaledSize   = [ iconScale * iconSize[0],   iconScale * iconSize[1]   ];
    //   const scaledAnchor = [ iconScale * iconAnchor[0], iconScale * iconAnchor[1] ];

    //   return L.marker([lat, lng], {
    //     icon: L.icon({
    //       iconUrl:    emblemUrl,
    //       iconSize:   scaledSize,
    //       iconAnchor: scaledAnchor
    //     })
    //   });
    // }

    // handle normal SVG‐based symbols (house, danger, etc.)
    const sym = props['marker-symbol'];
    if (sym && icons[sym]) {
      const { iconUrl, iconSize, iconAnchor } = icons[sym].options;
      const cacheKey = `${sym}_${iconScale}_${civ.color}`;

      let svg = svgCache[cacheKey];
      if (!svg) {
        const raw = await loadSvgIconContent(iconUrl);
        svg = `
          <div style="
            width:${iconScale * iconSize[0]}px;
            height:${iconScale * iconSize[1]}px;
            color:${civ.color};
            display: block;
            margin: auto;
            justify-content: center;
            filter: drop-shadow(0 0 5px #000);
          ">${raw}</div>
        `;
        // transform: translate(-${iconScale*iconAnchor[0]}px, -${iconScale*iconAnchor[1]}px);
        svgCache[cacheKey] = svg;
      }

      return L.marker([lat, lng], {
        icon: L.divIcon({
          html:       svg,
          className:  '',
          iconSize:   [ iconScale * iconSize[0], iconScale * iconSize[1] ],
          iconAnchor: [ iconScale * iconAnchor[0], iconScale * iconAnchor[1] ]
        })
      });
    }

    // fallback → circleMarker
    return L.circleMarker([lat, lng], {
      radius:      iconScale * 4,
      fillColor:   color,
      color,
      fillOpacity: opacity
    });
  }

  // Render a LineString feature
  function renderLineString(geom, color, opacity) {
    // Lines → dashed polylines
    return L.polyline(geom.coordinates.map(c => [c[1], c[0]]), { color, weight: 2, opacity, dashArray: '4,4' });
  }

  // Render a Polygon feature
  function renderPolygon(geom, color, opacity) {
    // Polygons → blurred territories + fill
    return L.polygon(geom.coordinates[0].map(c => [c[1], c[0]]), { color, weight: 1, opacity, fillColor: color, fillOpacity: opacity ? opacity : DEF_OPACITY, className: meta.styles?.territoryBlur ? 'territory-blur' : null });
  }

  // render all emblems from wonder_pos.json
  async function renderEmblems() {
    const positions    = await loadWonderPositions();
    const { iconUrl: base, iconSize, iconAnchor } = icons['emblem'].options;
    const iconScale    = adjustIconSize(map);
  
    positions.forEach(pos => {
      // find the matching civ object
      const civ = civs.find(c => 
        c.name.toLowerCase() === pos.Civilization.toLowerCase()
      );
      if (!civ) return; // skip if not in your meta
      if (layersByCiv[civ.name.toLowerCase()].length > 0) // only show when something else from civ is visible
      {
        // build the emblem URL
        const fileName  = `${civ.name.toTitleCase()}_AoE2.png`;
        const emblemUrl = base.endsWith('/')
          ? base + fileName
          : base + '/' + fileName;

        // compute scaled size & anchor
        const scaledSize   = [ iconScale * iconSize[0],   iconScale * iconSize[1]   ];
        const scaledAnchor = [ iconScale * iconAnchor[0], iconScale * iconAnchor[1] ];
    
        // make & add the marker
        const marker = L.marker(
          [pos.Latitude, pos.Longitude],
          {
            icon: L.icon({
              iconUrl:    emblemUrl,
              iconSize:   scaledSize,
              iconAnchor: scaledAnchor,
              pane:       'emblems'
            })
          }
        )
        .addTo(map)
        .bindPopup(civ.name.toTitleCase())
        ;
    
        // store it so clearAllLayers will remove it next time
        layersByCiv[civ.name.toLowerCase()].push(marker);
      }
    });
  }

  // Main Bootstrap
  async function main() {
    initMap();

    // Add event listener to adjust icon size on zoom change
    map.on('zoom', () => {
      const currentYear = parseInt(slider.noUiSlider.get(), 10);
      render(currentYear);
    });

    initGridToggle();
    await loadMetaData();

    const slider = initSlider(render);

    // play/pause button
    document.getElementById('play-pause').addEventListener('click',()=>playActive?stopPlay():startPlay(slider));

    // initial render
    const initYear = parseInt(slider.noUiSlider.get(), 10);
    render(initYear);
  }

  main();
});