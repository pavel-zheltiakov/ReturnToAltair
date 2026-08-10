// The battle over the station, drawn behind the words on the landing page.
//
// Everything in it is the game's, not an impression of it. The hulls are the vertex and face
// tables out of assets/ships/ships.json, by way of ships.js. The world is the terran recipe from
// web/js/textures.js — the same value noise, the same elevation ramp, the same ice caps and cloud
// field the game paints a habitable planet with. The sky is the domain-warped nebula from
// web/js/scene3d.js, dimmed the same way. The paint is what SceneStyles.cs dresses a police ship,
// a pirate and a station in, and the lasers are the red the game fires.
//
// That is the whole point of doing it this way. A hero image that promises a look the download
// does not have is a refund waiting to happen, so nothing on this canvas is invented: it is the
// game's own recipes, run at the game's own numbers, in a smaller renderer.
//
// A 2D canvas rather than WebGL on purpose. The scene is a few hundred polygons a frame and two
// blits, so the GPU would spend more time being set up than used — and a landing page that fails
// on a machine with no WebGL 2 turns away exactly the visitor who most needs to be told the
// download will work.
//
// Hidden surfaces are removed by backface culling — a face is drawn only when it points at the
// camera. On a convex hull, which every Elite ship and the station are, that is not an
// approximation of a depth buffer; it is exactly one.
//
// The same convexity does the lasers. A beam is clipped against the hulls twice: once along its
// own length, so it stops at the first thing in the way instead of passing through the station,
// and once along the line of sight, so the stretch of it that is behind a hull is not drawn. A
// canvas has no depth buffer and anything drawn after the ships is drawn on top of them, which is
// how a bolt ends up crossing a dock it is a kilometre beyond. And it has a thickness, in metres
// rather than in pixels, so the same bolt is a bar up close and a thread out by the station.

(function () {
    'use strict';

    var canvas = document.getElementById('scene');
    if (!canvas || !window.SHIPS) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ---- the paint -----------------------------------------------------------------------------
    //
    // Straight out of SceneStyles.cs: the hull each kind of ship is painted in — a police ship's
    // white, a trader's grey, the three the pirates come in. The page's own custom properties are
    // deliberately not read: this canvas is the dark scene whatever the reader's colour scheme is,
    // for the same reason the hero over it pins its own palette.

    var LOOK = {
        trader: '#aeb6bf',
        police: '#dfe6ec',
        pirate: '#6e6a63',
        pirate2: '#75594b',
        pirate3: '#5f6a72'
    };

    var STATION_HULL = '#6a747e';    // a mid-tech dock: neither grimy nor gleaming
    var WINDOW = '#7ddf7d';
    var LASER = '#ff5a46';           // flight.js's beam, to the byte
    var SPARK = '#ffee96';           // render3d.js's hot laser sparks
    var FIRE = '#ffd27a';            // and its debris fireball
    var HAZE_BLUE = '#86c0ff';       // the terran atmosphere from planetSpec

    // Camera space: +X right, +Y up, +Z into the screen, camera at the origin. One light for the
    // whole picture — the system's star, up and to the left and a little behind the camera. Two
    // would read as two suns, and this game has never had more than one.
    var SUN = [-0.50, 0.60, -0.62];

    // What sunlight and the dark do to a colour. The lit side keeps the hull's own colour, warmed
    // slightly; the unlit side does not go to black but to the cold blue that fills space in every
    // screenshot of this game.
    var SUNLIGHT = [1.06, 1.00, 0.90];
    var AMBIENT = [0.27, 0.33, 0.44];

    // The cold edge on a hull that is nearly side-on to the camera. It is not physics — it is what
    // stops an unlit ship from being a hole in the picture, which at these sizes it otherwise is.
    var RIM = [70, 118, 168];

    // What distance turns everything into: the sky's own average, so a ship at the back of the box
    // fades into the nebula instead of going transparent. Solid hulls have to stay solid — a
    // Coriolis you can see through is a Coriolis made of glass.
    var FOG = [9, 20, 36];

    var width = 0, height = 0, focal = 0, dpr = 1;

    // A phone is a different picture, not a smaller one. On a wide screen the words are a column
    // on the left and the scene has the right-hand half to itself; on a tall one the words are the
    // whole width and the panel takes everything below them, so the only frame the scene has is
    // the strip across the top. Everything that is placed is placed twice because of this.
    var tall = false;

    // ---- vectors -------------------------------------------------------------------------------

    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

    function normalise(a) {
        var n = Math.sqrt(dot(a, a)) || 1;
        return [a[0] / n, a[1] / n, a[2] / n];
    }

    SUN = normalise(SUN);

    // Yaw about Y, then pitch about X, then roll about Z, as a flat 9-element matrix. Ships are
    // flown by these three angles alone — there is no physics here, only a camera crew.
    function orient(yaw, pitch, roll) {
        var cy = Math.cos(yaw), sy = Math.sin(yaw);
        var cp = Math.cos(pitch), sp = Math.sin(pitch);
        var cr = Math.cos(roll), sr = Math.sin(roll);

        return [
            cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
            cp * sr, cp * cr, -sp,
            -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp
        ];
    }

    function apply(m, p) {
        return [
            m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
            m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
            m[6] * p[0] + m[7] * p[1] + m[8] * p[2]
        ];
    }

    // The same matrix backwards. A rotation's inverse is its transpose, which is why the laser can
    // be carried into a ship's own coordinates rather than the ship's fourteen planes being carried
    // out into the world.
    function unapply(m, p) {
        return [
            m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
            m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
            m[2] * p[0] + m[5] * p[1] + m[8] * p[2]
        ];
    }

    // ---- colour --------------------------------------------------------------------------------

    function parse(hex) {
        return [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16)
        ];
    }

    function rgba(colour, alpha) {
        var c = typeof colour === 'string' ? parse(colour) : colour;
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')';
    }

    function mix(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

    function smoothstep(a, b, x) {
        var t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
    }

    // Standard HSL, which is what THREE.Color.setHSL does — so the planet ramp below can be
    // copied out of textures.js as written rather than translated into hex and rounded on the way.
    function hslChannel(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return (p + (q - p) * 6 * t) * 255;
        if (t < 1 / 2) return q * 255;
        if (t < 2 / 3) return (p + (q - p) * 6 * (2 / 3 - t)) * 255;
        return p * 255;
    }

    function hsl(h, s, l) {
        if (s === 0) return [l * 255, l * 255, l * 255];
        var q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return [hslChannel(p, q, h + 1 / 3), hslChannel(p, q, h), hslChannel(p, q, h - 1 / 3)];
    }

    // ---- the game's noise ----------------------------------------------------------------------
    //
    // mulberry32, the value-noise lattice and fbm, lifted from web/js/textures.js. Same generator,
    // same smoothstep interpolation, same octave falloff. This is the reason the world below is
    // one of the game's worlds rather than a stock space background with a gradient on it.

    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makeValueNoise(rnd, size) {
        var g = new Float32Array(size * size);
        for (var i = 0; i < g.length; i++) g[i] = rnd();

        return function (x, y) {
            var xi = Math.floor(x), yi = Math.floor(y);
            var xf = x - xi, yf = y - yi;
            var sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
            var i0 = ((yi % size + size) % size) * size;
            var i1 = (((yi + 1) % size + size) % size) * size;
            var j0 = (xi % size + size) % size;
            var j1 = ((xi + 1) % size + size) % size;
            var a = g[i0 + j0], b = g[i0 + j1], c = g[i1 + j0], d = g[i1 + j1];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        };
    }

    function fbm(noise, x, y, octaves) {
        var v = 0, amp = 0.5, f = 1;
        for (var o = 0; o < octaves; o++) {
            v += amp * noise(x * f, y * f);
            amp *= 0.5;
            f *= 2;
        }
        return v;
    }

    // Fixed seeds, not random ones. Two visitors comparing the page should be looking at the same
    // sky, and a reader who resizes the window should not get a different planet for it.
    var landNoise = makeValueNoise(mulberry32(0x51a7e), 96);
    var cloudNoise = makeValueNoise(mulberry32(0x9e3779b9), 96);
    var nebulaNoise = makeValueNoise(mulberry32(0x2c1b3a), 96);

    // ---- the models ----------------------------------------------------------------------------
    //
    // Faces arrive as rings of vertex indices with no stated winding, so each one's normal is taken
    // from its first corner and turned outward by testing it against the face's own centre. That
    // test is only sound on a convex hull — which every Elite ship and the station are, near enough
    // that no face on any of the six comes out wrong.
    //
    // The edge list comes over as well as the faces, and it is not the same information. Most of
    // its edges are sides of faces and are already drawn; the ones left over are what the blueprint
    // draws *on* the hull — the cockpit, the engine block, the gun ports, and on the Coriolis the
    // docking slot itself. Those lines are most of what tells a Krait from a Mamba at fifty pixels,
    // and the game's own 3-D build keeps them for exactly that reason.

    var models = {};

    // A detail edge is drawn when the face it lies on is drawn, so each one is given the face whose
    // plane it sits closest to. On a convex hull that is the face it is painted on, and the hidden
    // surface test the hull already passed does the rest.
    function hostFace(faces, vertices, a, b) {
        var host = 0;
        var closest = Infinity;

        for (var i = 0; i < faces.length; i++) {
            var face = faces[i];
            var gap = Math.max(
                Math.abs(dot(face.normal, vertices[a]) - face.offset),
                Math.abs(dot(face.normal, vertices[b]) - face.offset)
            );
            if (gap < closest) { closest = gap; host = i; }
        }

        return host;
    }

    // Detail edges that close into a ring are a shape rather than a scratch — a slot, a housing, a
    // port — and a shape can be filled. Same walk the game's greeble pass does: adjacency over the
    // detail edges, then follow each one round until it comes back to where it started.
    function ringsOf(detail) {
        var links = {};
        var loops = [];
        var seen = {};

        detail.forEach(function (edge) {
            (links[edge.a] || (links[edge.a] = [])).push(edge.b);
            (links[edge.b] || (links[edge.b] = [])).push(edge.a);
        });

        detail.forEach(function (edge) {
            if (seen[edge.a]) return;

            var ring = [];
            var prev = -1;
            var at = edge.a;
            var closed = false;

            for (var guard = 0; guard < 64; guard++) {
                var out = links[at];
                if (!out || out.length !== 2) break;     // a stray line, not a ring

                seen[at] = true;
                ring.push(at);

                var next = out[0] === prev ? out[1] : out[0];
                prev = at;
                at = next;

                if (at === edge.a) { closed = true; break; }
            }

            if (closed && ring.length >= 3) loops.push({ ring: ring, face: edge.face });
        });

        return loops;
    }

    Object.keys(window.SHIPS).forEach(function (key) {
        var source = window.SHIPS[key];
        var vertices = source.v;
        var faces = [];
        var reach = 0;
        var snout = 0;

        vertices.forEach(function (p) {
            reach = Math.max(reach, Math.sqrt(dot(p, p)));
            // How far forward the hull actually goes, which is not the same as how big it is: a
            // Sidewinder is wider than it is long, so a beam started at its radius would leave from
            // a point in space ahead of the ship rather than from the tip of it.
            snout = Math.max(snout, p[2]);
        });

        source.f.forEach(function (ring) {
            var a = vertices[ring[0]], b = vertices[ring[1]], c = vertices[ring[2]];
            var normal = cross(
                [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
                [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
            );

            var centre = [0, 0, 0];
            ring.forEach(function (i) {
                centre[0] += vertices[i][0] / ring.length;
                centre[1] += vertices[i][1] / ring.length;
                centre[2] += vertices[i][2] / ring.length;
            });

            if (dot(normal, centre) < 0) normal = [-normal[0], -normal[1], -normal[2]];
            normal = normalise(normal);

            // The face as a half-space: everything inside the hull satisfies n·x <= offset. Six
            // planes and a convex solid are all a laser needs to know where it stops.
            faces.push({
                ring: ring,
                normal: normal,
                centre: centre,
                offset: dot(normal, centre)
            });
        });

        // Every edge a face already draws, so the leftovers can be told apart from them.
        var drawn = {};
        source.f.forEach(function (ring) {
            for (var i = 0; i < ring.length; i++) {
                var a = ring[i], b = ring[(i + 1) % ring.length];
                drawn[Math.min(a, b) + ':' + Math.max(a, b)] = true;
            }
        });

        var detail = [];
        (source.e || []).forEach(function (edge) {
            var a = edge[0], b = edge[1];
            if (drawn[Math.min(a, b) + ':' + Math.max(a, b)]) return;
            detail.push({ a: a, b: b, face: hostFace(faces, vertices, a, b) });
        });

        models[key] = {
            name: source.name,
            vertices: vertices,
            faces: faces,
            detail: detail,
            loops: ringsOf(detail),
            reach: reach,
            snout: snout
        };
    });

    // ---- the cast ------------------------------------------------------------------------------
    //
    // Camera at the origin looking down +Z, +Y up. Everything is placed in ship units — a Cobra is
    // 240 of them nose to tail — so the numbers below are distances a player would recognise.

    // Where a thing goes is said in fractions of the frame, not in world coordinates, and turned
    // into world coordinates at the distance it is standing. A hero has to compose itself on a
    // phone and on a monitor from the same numbers, and "x = 1300" is a different picture at every
    // window width — off the side of the frame at most of them.
    function place(sx, sy, z) {
        return [
            (sx - 0.5) * width * z / focal,
            (0.5 - sy) * height * z / focal,
            z
        ];
    }

    function screenX(p) { return (0.5 + p[0] * focal / p[2] / width); }
    function screenY(p) { return (0.5 - p[1] * focal / p[2] / height); }

    var station = {
        model: models.coriolis,
        frame: [0.80, 0.34, 2500],
        position: [0, 0, 2500],
        spin: 0,
        hull: parse(STATION_HULL)
    };

    // The trader that was minding its own business, the four that jumped it, and the two Vipers
    // that turned up. Seven is what makes this read as a battle rather than as ships passing:
    // with fewer, there are moments with nothing in frame firing, and a still of the page taken at
    // one of those moments is the page.
    //
    // Each one keeps to a band of distance, and the bands are the reason this reads as a volume of
    // space rather than as a mobile hanging in front of a photograph. All seven used to fly in one
    // shell around the station, which meant seven ships the same size on a flat plane; now a pair
    // duel close enough to fill a corner, three fight around the dock, and two are specks trading
    // fire well past it. The station sits at 2500, so ships cross in front of it and behind it.
    var FLEET = [
        { model: 'viper', look: 'police', side: 'law', scale: 1.3, speed: 400, turn: 0.95, band: [1250, 2000] },
        { model: 'mamba', look: 'pirate2', side: 'pirate', scale: 1.3, speed: 360, turn: 0.85, band: [1250, 2000] },
        { model: 'cobra_mk3', look: 'trader', side: 'law', scale: 1.5, speed: 300, turn: 0.55, band: [1900, 3100] },
        { model: 'krait', look: 'pirate', side: 'pirate', scale: 1.3, speed: 330, turn: 0.75, band: [1900, 3100] },
        { model: 'sidewinder', look: 'pirate3', side: 'pirate', scale: 1.4, speed: 340, turn: 0.8, band: [1900, 3100] },
        { model: 'viper', look: 'police', side: 'law', scale: 1.7, speed: 390, turn: 0.9, band: [3500, 5600] },
        { model: 'krait', look: 'pirate2', side: 'pirate', scale: 1.7, speed: 320, turn: 0.7, band: [3500, 5600] }
    ];

    var ships = [];
    var beams = [];
    var debris = [];

    // Somewhere in frame, at a distance worth drawing. Everything that needs a point in space — a
    // ship being launched, a waypoint to break off toward — asks for one here, so the whole scene
    // stays inside the part of the frame the words are not in. The depth comes from the ship's own
    // band, so a close-in duel stays close in and the far pair stay far.
    function spot(ship) {
        var band = ship.band;
        var z = band[0] + Math.random() * (band[1] - band[0]);

        return tall
            ? place(0.08 + Math.random() * 0.84, 0.03 + Math.random() * 0.36, z)
            : place(0.57 + Math.random() * 0.41, 0.08 + Math.random() * 0.76, z);
    }

    // A lane each rather than pure noise: seven ships each landing wherever the random number
    // generator likes puts three of them in one corner about a third of the time, and one of them
    // in front of the wordmark — the only thing on the page a reader cannot look past.
    function launch(ship, index) {
        var lane = (index % FLEET.length) / FLEET.length;
        var z = ship.band[0] + Math.random() * (ship.band[1] - ship.band[0]);

        ship.position = tall
            ? place(0.08 + lane * 0.76 + Math.random() * 0.1, 0.02 + Math.random() * 0.36, z)
            : place(0.58 + lane * 0.30 + Math.random() * 0.08, 0.12 + Math.random() * 0.62, z);

        // Pointed somewhere it could plausibly have come from, and flying there from the first
        // frame — a ship that starts pointing one way and moving another is the exact thing this
        // model exists to stop.
        ship.waypoint = spot(ship);
        ship.target = null;
        ship.breakoff = 0;

        var toward = [
            ship.waypoint[0] - ship.position[0],
            ship.waypoint[1] - ship.position[1],
            ship.waypoint[2] - ship.position[2]
        ];
        var span = Math.sqrt(dot(toward, toward)) || 1;

        ship.yaw = Math.atan2(toward[0], toward[2]);
        ship.pitch = Math.asin(Math.max(-1, Math.min(1, -toward[1] / span)));
        ship.roll = 0;

        ship.health = 1;
        ship.alive = true;
        ship.arriving = 0;
    }

    FLEET.forEach(function (entry) {
        // Launched by the first resize, not here: where a ship goes is a fraction of a frame that
        // has not been measured yet.
        ships.push({
            model: models[entry.model],
            hull: parse(LOOK[entry.look]),
            side: entry.side,
            scale: entry.scale,
            band: entry.band,
            position: [0, 0, 2000],
            yaw: 0, pitch: 0, roll: 0,
            // A Viper turns faster than a Cobra and a Cobra outruns a Sidewinder, in this scene as
            // in the game; the spread is also what keeps seven ships from flying as one shoal.
            speed: entry.speed,
            turn: entry.turn,
            waypoint: null,
            target: null,
            breakoff: 0,
            health: 1,
            alive: true,
            arriving: 0,
            cooldown: 0.6 + Math.random() * 2.4
        });
    });

    // ---- projection ----------------------------------------------------------------------------

    var NEAR = 60;

    function project(p) {
        var k = focal / p[2];
        return [width / 2 + p[0] * k, height / 2 - p[1] * k, p[2]];
    }

    // How far into the fog a thing is: 0 in the reader's lap, 1 at the back of the box. Hulls use
    // it to lose their colour, and the glowing things — beams, sparks, drives — to lose their
    // brightness, which for light is the same statement.
    //
    // The box is deeper than it was, because the ships are spread through a real depth now rather
    // than pinned to one shell. On the old ramp the far pair were past full fog and simply not
    // there.
    function fade(z) {
        return clamp01((z - 1500) / 4800);
    }

    function haze(z) {
        return 1 - fade(z) * 0.9;
    }

    // ---- the sky -------------------------------------------------------------------------------
    //
    // The nebula out of scene3d.js: value-noise fbm, domain-warped by three more fbms, run through
    // one of the game's four-stop palettes and dimmed hard so the black stays black. The game does
    // this per system onto a sky sphere; here it is one flat field, built once and blitted, which
    // is the whole cost of the backdrop for the rest of the session.
    //
    // Deliberately low resolution and blown up. A nebula is a smooth thing — the interpolation the
    // browser does on the way up is a free blur, and the alternative is a hundred times the work
    // for a picture nobody can tell apart.

    var VOID = [[0.02, 0.02, 0.05], [0.07, 0.05, 0.16], [0.18, 0.10, 0.34], [0.40, 0.18, 0.50]];
    var DEEP = [[0.02, 0.03, 0.06], [0.05, 0.10, 0.20], [0.10, 0.20, 0.40], [0.26, 0.40, 0.62]];
    var NEBULA_DIM = 0.42;

    var sky = null;

    function paletteColour(palette, d) {
        var x = clamp01(d) * 2.999;
        var lo = Math.floor(x);
        return mix(palette[lo], palette[lo + 1], x - lo);
    }

    function buildSky() {
        // The field is built about two hundred samples across whatever the window is, so a phone
        // and a monitor cost the same and get the same cloud.
        var nw = 200;
        var nh = Math.max(60, Math.round(nw * height / width));

        var field = document.createElement('canvas');
        field.width = nw;
        field.height = nh;

        var fctx = field.getContext('2d');
        var image = fctx.createImageData(nw, nh);
        var data = image.data;
        var scale = 3.4;

        for (var j = 0; j < nh; j++) {
            for (var i = 0; i < nw; i++) {
                var x = (i / nw) * scale;
                var y = (j / nh) * scale * (nh / nw);

                var wx = fbm(nebulaNoise, x + 11.3, y, 3) - 0.5;
                var wy = fbm(nebulaNoise, x, y + 5.1, 3) - 0.5;

                var d = fbm(nebulaNoise, x + 2 * wx, y + 2 * wy, 6);
                d = smoothstep(0.46, 0.92, d);

                // Two palettes drifting across one sky, as in the game — a nebula that is all one
                // hue reads as a gradient, and a gradient reads as a stock background.
                var blend = smoothstep(0.34, 0.66, fbm(nebulaNoise, x * 0.8 + 19, y * 0.8 + 7, 2));
                var c = mix(paletteColour(VOID, d), paletteColour(DEEP, d), blend);

                var o = (j * nw + i) * 4;
                data[o] = Math.min(255, c[0] * NEBULA_DIM * 255);
                data[o + 1] = Math.min(255, c[1] * NEBULA_DIM * 255);
                data[o + 2] = Math.min(255, c[2] * NEBULA_DIM * 255);
                data[o + 3] = 255;
            }
        }

        fctx.putImageData(image, 0, 0);

        sky = document.createElement('canvas');
        sky.width = width;
        sky.height = height;

        var sctx = sky.getContext('2d');
        sctx.fillStyle = '#000814';
        sctx.fillRect(0, 0, width, height);
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(field, 0, 0, width, height);

        // Stars, as the game draws them: little squares, not discs and not twinkling. They belong
        // to the celestial sphere, so they hold still while the fight moves in front of them.
        var count = Math.round(Math.min(420, (width * height) / 4200));
        var random = mulberry32(0x1984c0);

        for (var s = 0; s < count; s++) {
            var sx = Math.floor(random() * width);
            var sy = Math.floor(random() * height);
            var bright = random();
            var size = Math.max(1, Math.round((bright > 0.94 ? 2.4 : bright > 0.7 ? 1.6 : 1) * dpr));

            sctx.fillStyle = 'rgba(' +
                (200 + Math.round(bright * 55)) + ',' +
                (216 + Math.round(bright * 39)) + ',255,' +
                (0.28 + bright * 0.66).toFixed(2) + ')';
            sctx.fillRect(sx, sy, size, size);
        }
    }

    // ---- the world -----------------------------------------------------------------------------
    //
    // planetSpec's "terran" recipe, rendered per pixel: the elevation ramp from deep ocean through
    // shelf and shore to forest and grey peaks, the polar ice, the cloud field on its own noise,
    // and the blue haze over the whole disc. Same numbers as the game, sampled straight onto the
    // sphere instead of through an equirectangular texture — at this size there is no seam to
    // hide and one fewer resampling to blur it.
    //
    // Built once, when the canvas is sized, and blitted every frame after that. A planet rotating
    // fast enough to see would be wrong anyway: the game's spin at this distance is a pixel a
    // minute, and the motion in this picture belongs to the ships.

    var TERRAN = {
        seaLevel: 0.48,
        iceLat: 0.8,
        cloud: 0.5,
        ice: [232, 240, 244],
        haze: 0.2,
        stops: [
            { e: 0.30, c: hsl(0.57, 0.66, 0.16) },
            { e: 0.46, c: hsl(0.57, 0.55, 0.30) },
            { e: 0.48, c: hsl(0.57, 0.42, 0.42) },
            { e: 0.52, c: hsl(0.26, 0.44, 0.34) },
            { e: 0.78, c: hsl(0.22, 0.40, 0.26) },
            { e: 0.95, c: [207, 212, 207] }
        ]
    };

    function rampAt(stops, e) {
        if (e <= stops[0].e) return stops[0].c;
        for (var i = 1; i < stops.length; i++) {
            if (e <= stops[i].e) {
                return mix(stops[i - 1].c, stops[i].c, smoothstep(stops[i - 1].e, stops[i].e, e));
            }
        }
        return stops[stops.length - 1].c;
    }

    var world = { image: null, left: 0, top: 0, width: 0, height: 0, radius: 0, cx: 0, cy: 0 };

    function buildWorld() {
        // Wide: the planet is the bottom-right corner, most of it below the page. Tall: the frame
        // is four screens of it and the bottom right is a place nobody will ever look, so the
        // world comes up behind the words instead — dimmed by the veil over it, which is the
        // arrangement that keeps the words readable.
        // A wider frame gets more sky, not more planet. Taking the width raw means a 2560-pixel
        // monitor draws a disc of twice the radius a 1280 one does over a hero that is no taller,
        // so "the bottom-right corner" becomes the whole frame: one continent, smeared across the
        // page, with nothing at that scale for the six octaves under it to put in it. Past two to
        // one the width stops counting and the planet holds the size it had at two to one.
        var reach = Math.min(width, height * 2);
        var radius = tall ? width * 0.62 : Math.max(reach, height) * 0.46;
        var cx = tall ? width * 0.72 : width * 0.78;
        var cy = tall ? height * 0.10 + radius * 0.9 : height * 1.12;

        world.radius = radius;
        world.cx = cx;
        world.cy = cy;

        // Only the part of the disc that is on the page is worth a pixel of work. The planet is a
        // corner of the frame and two thirds of it are below the fold for ever.
        var left = Math.max(0, Math.floor(cx - radius));
        var top = Math.max(0, Math.floor(cy - radius));
        var right = Math.min(width, Math.ceil(cx + radius));
        var bottom = Math.min(height, Math.ceil(cy + radius));

        if (right <= left || bottom <= top) { world.image = null; return; }

        // Sampled at CSS resolution and blown back up to device pixels. Every sample is ten
        // octaves of noise, so this is the difference between forty milliseconds once and a
        // hundred and sixty — and the surface is soft enough that nobody can tell which one they
        // are looking at.
        var step = dpr;
        var w = Math.ceil((right - left) / step);
        var h = Math.ceil((bottom - top) / step);

        var buffer = document.createElement('canvas');
        buffer.width = w;
        buffer.height = h;

        var bctx = buffer.getContext('2d');
        var image = bctx.createImageData(w, h);
        var data = image.data;

        var edge = radius / step;           // the limb, in buffer pixels, for one pixel of feather
        var ice = TERRAN.ice;
        var hazeColour = parse(HAZE_BLUE);
        var white = [255, 255, 255];

        for (var j = 0; j < h; j++) {
            var Y = (cy - (top + j * step)) / radius;

            for (var i = 0; i < w; i++) {
                var X = ((left + i * step) - cx) / radius;
                var d2 = X * X + Y * Y;
                var o = (j * w + i) * 4;

                if (d2 >= 1) continue;      // off the disc; the alpha stays zero

                var Z = Math.sqrt(1 - d2);  // the sphere's normal, toward the camera

                var lat = Math.asin(clamp01(Math.abs(Y)) * (Y < 0 ? -1 : 1));
                var lon = Math.atan2(X, Z);
                var row = (lat / Math.PI + 0.5) * 512;   // the game's texture is 1024 x 512

                // The game wraps longitude onto a circle in noise space so the seam vanishes, and
                // walks latitude along a line. Copied as written, constants and all.
                var nx = Math.cos(lon) * 2.2 + 4 + row / 68;
                var ny = Math.sin(lon) * 2.2 + 4 + row / 102;

                var elevation = fbm(landNoise, nx, ny, 6);
                var cloud = fbm(cloudNoise, nx * 2.4 + row / 160, ny * 0.8 + row / 90, 4);

                var colour = rampAt(TERRAN.stops, elevation);

                var polar = Math.abs(lat) / (Math.PI / 2);
                colour = mix(colour, ice,
                             smoothstep(TERRAN.iceLat, TERRAN.iceLat + 0.12,
                                        polar + (elevation - 0.5) * 0.14));
                colour = mix(colour, white, smoothstep(0.58, 0.78, cloud) * TERRAN.cloud);
                colour = mix(colour, hazeColour, TERRAN.haze * 0.18);

                // One sun, the same one the ships are lit by. The terminator is soft rather than a
                // hard line because an atmosphere scatters light around the curve — and because a
                // hard line at this size looks like a bug.
                var light = clamp01((dot([X, Y, -Z], SUN) + 0.12) / 1.12);

                // Held a little under full daylight on purpose. This is the backdrop to a page of
                // words, and a planet at its own true brightness takes the page away from them.
                var lit = 0.05 + 0.80 * light * light * (3 - 2 * light) * (0.72 + 0.28 * Z);

                // The limb: atmosphere piles up where the surface turns away, which is the thing
                // that says "world" rather than "circle".
                var rim = (1 - Z) * (1 - Z) * (1 - Z) * light * 1.6;

                data[o] = Math.min(255, colour[0] * lit + hazeColour[0] * rim);
                data[o + 1] = Math.min(255, colour[1] * lit + hazeColour[1] * rim);
                data[o + 2] = Math.min(255, colour[2] * lit + hazeColour[2] * rim);
                data[o + 3] = 255 * clamp01((1 - Math.sqrt(d2)) * edge);
            }
        }

        bctx.putImageData(image, 0, 0);

        world.image = buffer;
        world.left = left;
        world.top = top;
        world.width = right - left;
        world.height = bottom - top;
    }

    function drawWorld() {
        if (!world.image) return;

        ctx.drawImage(world.image, world.left, world.top, world.width, world.height);

        // The glow the atmosphere throws outside the disc, on the lit side only. A ring all the
        // way round is a halo, and a planet's dark side has no edge to see.
        var facing = Math.atan2(-SUN[1], SUN[0]);

        ctx.beginPath();
        ctx.arc(world.cx, world.cy, world.radius + 4 * dpr, facing - 1.4, facing + 1.4);
        ctx.strokeStyle = rgba(HAZE_BLUE, 0.16);
        ctx.lineWidth = 11 * dpr;
        ctx.stroke();
    }

    // ---- hulls ---------------------------------------------------------------------------------

    // One face, lit. The game shades its hulls with a real light and a real material; this is the
    // same idea with the specular thrown away — the lit side keeps the ship's own paint, the
    // shadowed side falls to the blue of the sky rather than to black, the edge-on faces catch a
    // cold rim, and distance mixes the lot into the fog.
    function litFill(rgb, k, rim, mist, alpha) {
        var c = [
            rgb[0] * (AMBIENT[0] + SUNLIGHT[0] * k) + RIM[0] * rim,
            rgb[1] * (AMBIENT[1] + SUNLIGHT[1] * k) + RIM[1] * rim,
            rgb[2] * (AMBIENT[2] + SUNLIGHT[2] * k) + RIM[2] * rim
        ];

        c = mix(c, FOG, mist * 0.78);

        return 'rgba(' +
            Math.round(Math.min(255, c[0])) + ',' +
            Math.round(Math.min(255, c[1])) + ',' +
            Math.round(Math.min(255, c[2])) + ',' +
            alpha.toFixed(3) + ')';
    }

    // The recess a detail ring encloses — a docking slot, an engine block, a gun housing. Darker
    // than the plate it is cut into, and lit by the same distance.
    function recess(rgb, mist, alpha) {
        return litFill([rgb[0] * 0.42, rgb[1] * 0.44, rgb[2] * 0.5], 0.16, 0, mist, alpha);
    }

    // A solid hull, visible faces only. The plate edges are stroked as well as filled: a Krait at
    // eight hundred metres is thirty pixels across, and without the edges the panels merge into
    // one grey lozenge that could be any ship in the game.
    function drawHull(model, position, matrix, scale, rgb, mist, alpha, lights) {
        var points = [];
        var shown = [];
        var i;

        for (i = 0; i < model.vertices.length; i++) {
            var v = apply(matrix, model.vertices[i]);
            var world3 = [
                position[0] + v[0] * scale,
                position[1] + v[1] * scale,
                position[2] + v[2] * scale
            ];
            points.push(world3[2] > NEAR ? project(world3) : null);
        }

        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, 0.9 * dpr);

        for (i = 0; i < model.faces.length; i++) {
            var face = model.faces[i];
            var normal = apply(matrix, face.normal);
            var centre = apply(matrix, face.centre);
            var toFace = [
                position[0] + centre[0] * scale,
                position[1] + centre[1] * scale,
                position[2] + centre[2] * scale
            ];

            // Facing away from the camera: the far side of the hull, and the whole of hidden
            // surface removal in one comparison.
            if (dot(normal, toFace) >= 0) continue;

            var ring = face.ring;
            var visible = true;
            ctx.beginPath();

            for (var j = 0; j < ring.length; j++) {
                var p = points[ring[j]];
                if (!p) { visible = false; break; }
                if (j === 0) ctx.moveTo(p[0], p[1]);
                else ctx.lineTo(p[0], p[1]);
            }

            if (!visible) continue;
            ctx.closePath();

            var k = Math.max(0, dot(normal, SUN));

            // How side-on the face is to the camera. Square-on faces get nothing; the ones sliding
            // out of view get the rim, which is what draws the silhouette of a ship whose lit side
            // is turned away.
            var edgeOn = 1 - Math.abs(dot(normal, normalise(toFace)));
            var rim = edgeOn * edgeOn * edgeOn * 0.5;

            ctx.fillStyle = litFill(rgb, k, rim, mist, alpha);
            ctx.fill();
            ctx.strokeStyle = litFill(rgb, Math.min(1, k * 1.3 + 0.2), rim, mist, alpha * 0.9);
            ctx.stroke();
            shown[i] = true;

            if (lights && toFace[2] > NEAR) drawWindows(points, ring, toFace, alpha);
        }

        // The lines the blueprint draws on the hull rather than around it: the cockpit, the engine
        // block, the gun ports, and on a Coriolis the slot that is the only way in. Each belongs to
        // a face, so each is drawn when that face is — the hidden-surface test the hull already
        // passed, applied a second time to the marks on it.
        //
        // Not below a certain size. At twenty pixels across, panel lines are not detail; they are
        // a smudge that costs a hundred strokes a frame.
        if (!model.detail.length) return;
        if (model.reach * scale * focal / position[2] < 24) return;

        ctx.lineWidth = Math.max(0.7, 0.6 * dpr);

        for (i = 0; i < model.loops.length; i++) {
            var loop = model.loops[i];
            if (!shown[loop.face]) continue;

            var ringed = true;
            ctx.beginPath();

            for (var r = 0; r < loop.ring.length; r++) {
                var corner = points[loop.ring[r]];
                if (!corner) { ringed = false; break; }
                if (r === 0) ctx.moveTo(corner[0], corner[1]);
                else ctx.lineTo(corner[0], corner[1]);
            }

            if (!ringed) continue;
            ctx.closePath();
            ctx.fillStyle = lights ? rgba('#04121e', 0.9 * alpha) : recess(rgb, mist, alpha);
            ctx.fill();
        }

        // A dock's slot gets the lit rim that says "in here"; a ship's panel lines are shadow, and
        // shadow is what the same paint looks like with the sun off it.
        ctx.strokeStyle = lights
            ? rgba('#cfe4f4', 0.7 * alpha)
            : litFill(rgb, 0.04, 0, mist, alpha * 0.85);

        ctx.beginPath();

        for (i = 0; i < model.detail.length; i++) {
            var line = model.detail[i];
            if (!shown[line.face]) continue;

            var from = points[line.a], to = points[line.b];
            if (!from || !to) continue;

            ctx.moveTo(from[0], from[1]);
            ctx.lineTo(to[0], to[1]);
        }

        ctx.stroke();
    }

    // The dock's lit windows. Not a texture — one light per corner of each face that is turned far
    // enough toward us to have a wall facing this way, three in five of them lit, which is what
    // makes a Coriolis read as somewhere people live rather than as a grey shape.
    function drawWindows(points, ring, toFace, alpha) {
        var centre = project(toFace);
        var size = Math.max(1, 1.9 * dpr * Math.min(1.6, 2600 / toFace[2]));

        ctx.fillStyle = rgba(WINDOW, 0.75 * alpha);

        for (var w = 0; w < ring.length; w++) {
            if ((w * 7 + ring[w] * 13) % 5 > 2) continue;

            var corner = points[ring[w]];
            if (!corner) continue;

            var x = centre[0] + (corner[0] - centre[0]) * 0.62;
            var y = centre[1] + (corner[1] - centre[1]) * 0.62;
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
    }

    // There is no drive glow. There was one — a soft dot at the tail — and a dot is a sprite: it
    // sits behind the hull rather than on it, keeps its shape while the ship turns, and reads as
    // something following the ship rather than as part of it. A hull is geometry or it is nothing.

    // Turned so the slot is on the side of the dock the reader is on. The blueprint puts it on the
    // face at +z, which is the face pointing away from a camera that looks down +z — so the dock
    // used to be presented arse-on, with its one identifying feature hidden. Half a turn fixes it,
    // and the twenty-odd degrees left over are what stop the front face from being a flat diamond.
    function stationMatrix() { return orient(Math.PI + 0.42, 0.22, station.spin); }

    // The slot used to be drawn here: a rectangle in screen space, rotated by the station's spin
    // and pasted over the middle of the hull. It is not drawn here any more, because the blueprint
    // has it — four detail edges across the front face — and the model's own slot is on the face it
    // belongs to, turns with the dock in three dimensions rather than two, and goes round the back
    // with that face when the station turns. A rectangle over the centre is a sticker; this is a
    // hole in a wall.
    function drawStation() {
        drawHull(station.model, station.position, stationMatrix(), 1, station.hull,
                 fade(station.position[2]), 1, true);
    }

    // ---- the line of fire ------------------------------------------------------------------------
    //
    // A laser is a thing in the world, not a line drawn on the glass. Two consequences, and they
    // are the same piece of geometry read twice.
    //
    // It stops at the first hull it meets. A bolt that passes through the station and goes on to
    // hit a pirate behind it is not a shot, it is a decal.
    //
    // And the length of it behind a hull cannot be seen. A canvas has no depth buffer, so anything
    // drawn after the ships is drawn on top of them — which is how a beam ends up crossing a
    // Coriolis it is in fact a kilometre beyond. Both answers come out of asking where a ray enters
    // and leaves a convex solid, which every hull in this scene is.

    var solids = [];
    var EYE = [0, 0, 0];

    function refreshSolids() {
        solids.length = 0;

        for (var i = 0; i < ships.length; i++) {
            if (!ships[i].alive) continue;
            solids.push({
                owner: ships[i],
                model: ships[i].model,
                position: ships[i].position,
                matrix: orient(ships[i].yaw, ships[i].pitch, ships[i].roll),
                scale: ships[i].scale
            });
        }

        solids.push({
            owner: station,
            model: station.model,
            position: station.position,
            matrix: stationMatrix(),
            scale: 1
        });
    }

    // The sphere the hull sits in, tested before its planes are. Fourteen planes is not much work
    // on its own, but it is eight solids times twenty-odd samples times every beam alive, and the
    // overwhelming majority of those are a ray passing nowhere near the ship.
    function clears(solid, origin, direction, near, far) {
        var ox = origin[0] - solid.position[0];
        var oy = origin[1] - solid.position[1];
        var oz = origin[2] - solid.position[2];

        var square = dot(direction, direction) || 1;
        var t = -(ox * direction[0] + oy * direction[1] + oz * direction[2]) / square;
        t = t < near ? near : t > far ? far : t;

        var x = ox + direction[0] * t;
        var y = oy + direction[1] * t;
        var z = oz + direction[2] * t;
        var reach = solid.model.reach * solid.scale;

        return x * x + y * y + z * z > reach * reach;
    }

    // Where a ray enters and leaves a hull, measured in the ray's own parameter — or null for a
    // miss. A convex solid is the intersection of its faces' half-spaces, so this is the ordinary
    // slab clip with fourteen slabs rather than three. The ray is carried into the ship's
    // coordinates instead of the ship's planes out into the world: one transform against fourteen,
    // and the planes are written in model space already.
    function pierce(solid, origin, direction, near, far) {
        var o = unapply(solid.matrix, [
            (origin[0] - solid.position[0]) / solid.scale,
            (origin[1] - solid.position[1]) / solid.scale,
            (origin[2] - solid.position[2]) / solid.scale
        ]);
        var d = unapply(solid.matrix, [
            direction[0] / solid.scale,
            direction[1] / solid.scale,
            direction[2] / solid.scale
        ]);

        var faces = solid.model.faces;
        var enter = near, leave = far;

        for (var i = 0; i < faces.length; i++) {
            var face = faces[i];
            var slope = dot(face.normal, d);
            var gap = face.offset - dot(face.normal, o);

            if (slope > -1e-9 && slope < 1e-9) {
                if (gap < 0) return null;       // parallel to this plane, and outside it
                continue;
            }

            var t = gap / slope;
            if (slope < 0) { if (t > enter) enter = t; }
            else if (t < leave) leave = t;

            if (enter > leave) return null;
        }

        return [enter, leave];
    }

    // What the shot hits: the nearest hull between the muzzle and where it was aimed. Everything is
    // a candidate, including the ship's own wingmen and the dock — a gun does not know whose hull
    // it is looking at.
    function obstruct(shooter, from, to) {
        var direction = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        var at = 1;
        var struck = null;

        for (var i = 0; i < solids.length; i++) {
            var solid = solids[i];
            if (solid.owner === shooter) continue;      // it cannot shoot itself in the back
            if (clears(solid, from, direction, 0, at)) continue;

            var span = pierce(solid, from, direction, 0, at);
            if (!span || span[0] <= 0 || span[0] >= at) continue;

            at = span[0];
            struck = solid.owner;
        }

        return { at: at, struck: struck };
    }

    // Whether a point is behind something. The camera is at the origin, so the segment from the eye
    // to the point is the ray from the origin *along the point itself* — which turns the question
    // into "does any hull cover a stretch of the parameter between the two ends".
    //
    // The shooter is not excluded. A ship firing away from the camera fires from a muzzle it is
    // itself in front of, and the first stretch of that beam is genuinely hidden by the ship that
    // fired it; the muzzle is set a hair outside the nose so that the grazing case comes out on the
    // visible side of the test rather than flickering.
    function behind(point) {
        for (var i = 0; i < solids.length; i++) {
            var solid = solids[i];
            if (clears(solid, EYE, point, 0, 1)) continue;

            var span = pierce(solid, EYE, point, 0, 1);
            if (span && span[1] > 0.0005 && span[0] < 0.9995) return true;
        }

        return false;
    }

    var SIGHT_STEPS = 20;
    var runs = [];
    var probe = [0, 0, 0];

    function alongBeam(beam, t, out) {
        out[0] = beam.from[0] + (beam.to[0] - beam.from[0]) * t;
        out[1] = beam.from[1] + (beam.to[1] - beam.from[1]) * t;
        out[2] = beam.from[2] + (beam.to[2] - beam.from[2]) * t;
        return out;
    }

    function edgeOfSight(beam, lo, hi, loVisible) {
        for (var i = 0; i < 5; i++) {
            var mid = (lo + hi) / 2;
            if (!behind(alongBeam(beam, mid, probe)) === loVisible) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // The stretches of a beam that are actually in view, as pairs of parameters along it. Sampled
    // and then bisected at each crossing rather than solved outright: the silhouette of a hull from
    // a given eye is not a shape with a useful closed form, and five bisections put each cut well
    // inside a pixel.
    function inSight(beam) {
        runs.length = 0;

        var visible = !behind(alongBeam(beam, 0, probe));
        var start = 0;

        for (var i = 1; i <= SIGHT_STEPS; i++) {
            var t = i / SIGHT_STEPS;
            var now = !behind(alongBeam(beam, t, probe));
            if (now === visible) continue;

            var cut = edgeOfSight(beam, (i - 1) / SIGHT_STEPS, t, visible);
            if (visible) runs.push(start, cut); else start = cut;
            visible = now;
        }

        if (visible) runs.push(start, 1);
        return runs;
    }

    // A laser has a thickness, and a thickness is a distance like every other one: the same bar of
    // light covers more of the screen up close than it does out by the station. That is why each
    // stretch is a tapered quad and not a stroked line — a stroke is one width for its whole
    // length, which is a mark on the glass rather than a bolt in the world.
    var BEAM_RADIUS = 6.5;      // ship units, of which a Cobra is 240 nose to tail

    function beamWidth(z) {
        return Math.max(0.55 * dpr, BEAM_RADIUS * focal / z);
    }

    function bar(a, b, wa, wb, nx, ny) {
        ctx.beginPath();
        ctx.moveTo(a[0] + nx * wa, a[1] + ny * wa);
        ctx.lineTo(b[0] + nx * wb, b[1] + ny * wb);
        ctx.lineTo(b[0] - nx * wb, b[1] - ny * wb);
        ctx.lineTo(a[0] - nx * wa, a[1] - ny * wa);
        ctx.closePath();
    }

    function drawBeams() {
        var head = [0, 0, 0], tail = [0, 0, 0];

        beams.forEach(function (beam) {
            if (beam.from[2] <= NEAR || beam.to[2] <= NEAR) return;

            // A pulse laser is on or it is off. It holds full brightness for most of its life and
            // fades at the end, rather than dimming from the instant it is fired — multiplying the
            // fade by the distance haze as well left a beam at a third of its colour for most of
            // the time it was on screen, which is a beam nobody sees.
            var life = Math.min(1, (beam.life / beam.span) * 2.4);
            var alpha = Math.max(0, life) * (0.6 + 0.4 * haze(beam.to[2]));
            if (alpha <= 0.01) return;

            var stretches = inSight(beam);

            for (var i = 0; i < stretches.length; i += 2) {
                alongBeam(beam, stretches[i], head);
                alongBeam(beam, stretches[i + 1], tail);
                if (head[2] <= NEAR || tail[2] <= NEAR) continue;

                var a = project(head), b = project(tail);
                var dx = b[0] - a[0], dy = b[1] - a[1];
                var run = Math.sqrt(dx * dx + dy * dy);
                if (run < 0.01) continue;

                var nx = -dy / run, ny = dx / run;
                var wa = beamWidth(head[2]), wb = beamWidth(tail[2]);

                bar(a, b, wa, wb, nx, ny);
                ctx.fillStyle = rgba(LASER, 0.9 * alpha);
                ctx.shadowColor = rgba(LASER, 0.95 * alpha);
                ctx.shadowBlur = 20 * dpr;
                ctx.fill();
                ctx.shadowBlur = 0;

                // A white core inside the glow — a laser in this game is a bar of light, and the
                // colour belongs to the halo around it.
                bar(a, b,
                    Math.max(0.4 * dpr, wa * 0.36), Math.max(0.4 * dpr, wb * 0.36),
                    nx, ny);
                ctx.fillStyle = 'rgba(255,238,228,' + (0.95 * alpha).toFixed(3) + ')';
                ctx.fill();
            }
        });
    }

    function drawDebris() {
        debris.forEach(function (bit) {
            if (bit.position[2] <= NEAR) return;
            var p = project(bit.position);
            var alpha = Math.max(0, bit.life / bit.span) * haze(bit.position[2]);
            var size = Math.max(1, bit.size * focal / bit.position[2]);

            ctx.fillStyle = rgba(bit.colour, alpha);
            ctx.shadowColor = rgba(bit.colour, alpha * 0.8);
            ctx.shadowBlur = 10 * dpr;
            ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
            ctx.shadowBlur = 0;
        });
    }

    // ---- the fight -----------------------------------------------------------------------------

    // The nose, in whatever attitude the ship is in: the furthest point of the hull along its own
    // forward axis. Taken from the model rather than guessed at, so a Sidewinder's beam leaves a
    // Sidewinder's nose and a Cobra's leaves a Cobra's.
    function nose(ship) {
        // A hair outside the hull rather than a hair inside it. The muzzle is a point the occlusion
        // test asks about, and a point inside its own ship is a point that ship is always in front
        // of — which would blank the first stretch of every beam in the scene.
        var tip = apply(orient(ship.yaw, ship.pitch, ship.roll),
                        [0, 0, ship.model.snout * 1.02]);

        return [
            ship.position[0] + tip[0] * ship.scale,
            ship.position[1] + tip[1] * ship.scale,
            ship.position[2] + tip[2] * ship.scale
        ];
    }

    // The direction the ship is pointing, which since it flies its own nose is also the direction
    // it is going.
    function heading(ship) {
        var cp = Math.cos(ship.pitch);
        return [Math.sin(ship.yaw) * cp, -Math.sin(ship.pitch), Math.cos(ship.yaw) * cp];
    }

    function fire(shooter, target) {
        // Down the barrel, which is the nose, which is where the ship is going. Nothing here fires
        // sideways or over its own shoulder: the shot is only taken when the target is inside the
        // cone in front of the hull, so the beam always leaves the point of the ship.
        var from = nose(shooter);
        var to = target.position.slice();

        // And it ends at the first hull in the way. Aimed at the middle of a ship it stops at that
        // ship's skin; aimed across the dock it stops at the dock. Nothing in this scene shoots
        // through anything, which is also what makes the station read as a solid object rather than
        // as a picture of one.
        var blocked = obstruct(shooter, from, to);

        if (blocked.at < 1) {
            to = [
                from[0] + (to[0] - from[0]) * blocked.at,
                from[1] + (to[1] - from[1]) * blocked.at,
                from[2] + (to[2] - from[2]) * blocked.at
            ];
        }

        // Long enough that a still of this page — a screenshot, a preview card, a reader who looks
        // for two seconds — has a shot in it. Seven ships firing every second and a half with a
        // fifth of a second of beam is a picture with no fight in it most of the time.
        beams.push({ from: from, to: to, life: 0.3, span: 0.3 });

        var struck = blocked.struck;
        if (!struck) return;

        spark(to, 4, SPARK, 90);

        // Hitting is not the same as hurting. A hull that got in the way takes the beam and stops
        // it whoever owns it, but the damage stays between the two sides: a police wing that shoots
        // itself to pieces is a hero image with nothing left in it.
        if (struck === station || struck.side === shooter.side) return;

        // Not every shot lands, and one that always does turns a dogfight into a metronome.
        if (Math.random() < 0.55) {
            struck.health -= 0.3;
            if (struck.health <= 0) explode(struck);
        }
    }

    function spark(at, count, colour, speed) {
        for (var i = 0; i < count; i++) {
            debris.push({
                position: at.slice(),
                velocity: [
                    (Math.random() - 0.5) * speed,
                    (Math.random() - 0.5) * speed,
                    (Math.random() - 0.5) * speed
                ],
                colour: colour,
                size: 2 + Math.random() * 3,
                life: 0.4 + Math.random() * 0.5,
                span: 0.9
            });
        }
    }

    function explode(ship) {
        ship.alive = false;
        ship.respawn = 1.4 + Math.random() * 2.2;
        spark(ship.position, 26, FIRE, 260);
        spark(ship.position, 14, SPARK, 340);
    }

    // Whether a point is still inside the part of the frame this scene is allowed to use. A ship
    // that leaves it does not bounce off an invisible wall — it turns for home like anything else
    // that has a nose and a drive. Depth counts as leaving: a ship that chases a target out of its
    // own band is a ship on its way to being either a speck or the whole screen.
    function inFrame(p, ship) {
        var sx = screenX(p), sy = screenY(p);
        var x0 = tall ? 0.03 : 0.52, x1 = tall ? 0.97 : 1.0;
        var y1 = tall ? 0.42 : 0.94;
        var band = ship.band;
        var slack = (band[1] - band[0]) * 0.45;

        return sx > x0 && sx < x1 && sy > 0.02 && sy < y1 &&
               p[2] > band[0] - slack && p[2] < band[1] + slack;
    }

    function distance(a, b) {
        var d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        return Math.sqrt(dot(d, d));
    }

    function wrapAngle(a) {
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return a;
    }

    // Turn the nose toward a point at the rate this hull can turn, and bank into the turn on the
    // way. Yaw and pitch are what the ship is flown with; roll follows the yaw rather than leading
    // it, which is why a hard turn shows its belly and a straight run levels out.
    function steer(ship, aim, dt) {
        var to = [aim[0] - ship.position[0], aim[1] - ship.position[1], aim[2] - ship.position[2]];
        var span = Math.sqrt(dot(to, to)) || 1;

        var wantYaw = Math.atan2(to[0], to[2]);
        var wantPitch = Math.asin(Math.max(-1, Math.min(1, -to[1] / span)));

        var dYaw = wrapAngle(wantYaw - ship.yaw);
        var dPitch = wrapAngle(wantPitch - ship.pitch);
        var rate = ship.turn * dt;

        ship.yaw = wrapAngle(ship.yaw + Math.max(-rate, Math.min(rate, dYaw)));
        ship.pitch = Math.max(-1.2, Math.min(1.2, ship.pitch + Math.max(-rate, Math.min(rate, dPitch))));

        var bank = Math.max(-1.1, Math.min(1.1, -dYaw * 1.3));
        ship.roll += (bank - ship.roll) * Math.min(1, dt * 2.4);
    }

    function think(ship, dt) {
        if (!ship.alive) {
            ship.respawn -= dt;
            if (ship.respawn <= 0) {
                launch(ship, ships.indexOf(ship));
                // Fade in from nothing rather than appearing whole: a ship that pops into the
                // middle of the frame reads as a glitch, which is the one thing a hero image
                // cannot do.
                ship.arriving = 0.9;
            }
            return;
        }

        if (ship.arriving > 0) ship.arriving = Math.max(0, ship.arriving - dt);
        if (ship.breakoff > 0) ship.breakoff -= dt;

        // The nearest enemy, not a random one. Picking at random sends half the fleet across the
        // frame after somebody at the other end of it, and a ship in transit is a ship not
        // fighting — which is a hero image of seven ships flying in straight lines.
        if (!ship.target || !ship.target.alive) {
            var nearest = null, best = Infinity;

            ships.forEach(function (other) {
                if (!other.alive || other.side === ship.side || other === ship) return;

                // Weighted, not measured: an enemy in another band is three times as far away as
                // it looks, because going after it means leaving the depth this ship belongs in
                // and arriving somewhere it will only be turned round again.
                var span = distance(ship.position, other.position) *
                           (other.band[0] === ship.band[0] ? 1 : 3);

                if (span < best) { best = span; nearest = other; }
            });

            ship.target = nearest;
        }

        var to = ship.target ? [
            ship.target.position[0] - ship.position[0],
            ship.target.position[1] - ship.position[1],
            ship.target.position[2] - ship.position[2]
        ] : null;

        var range = to ? Math.sqrt(dot(to, to)) : 0;

        // Three things a ship can be doing, in order of who wins. Getting back into frame beats
        // everything; then the break after a pass, because two ships flying into each other is a
        // collision and not a dogfight; then the attack.
        var aim;
        var atWaypoint = ship.waypoint && distance(ship.position, ship.waypoint) < 420;

        if (!inFrame(ship.position, ship)) {
            if (!ship.waypoint || atWaypoint || !inFrame(ship.waypoint, ship)) {
                ship.waypoint = spot(ship);
            }
            aim = ship.waypoint;
            ship.breakoff = Math.max(ship.breakoff, 0.6);
        } else if (ship.breakoff > 0 || !ship.target) {
            if (!ship.waypoint || atWaypoint) ship.waypoint = spot(ship);
            aim = ship.waypoint;
        } else {
            aim = ship.target.position;

            // Close enough to have made the pass: peel off, pick somewhere else to be, and come
            // round again. Without this the whole fleet converges on one point and stays there.
            // Short, because a ship spending three seconds flying away is three seconds of the
            // fight the reader does not get to see. The distance scales with the band — four
            // hundred metres is a near miss up close and a docking manoeuvre out at five thousand.
            if (range < 400 * (ship.band[1] / 2000)) {
                ship.breakoff = 0.8 + Math.random() * 0.9;
                ship.waypoint = spot(ship);
            }
        }

        steer(ship, aim, dt);

        // Flies its own nose. This is the whole of the physics and the whole of the point: the
        // path curves because the ship turned, and the drive at the back is pushing it along the
        // line the hull is pointing down rather than dragging it sideways.
        var forward = heading(ship);
        ship.position[0] += forward[0] * ship.speed * dt;
        ship.position[1] += forward[1] * ship.speed * dt;
        ship.position[2] += forward[2] * ship.speed * dt;

        ship.cooldown -= dt;
        if (ship.cooldown > 0) return;

        // Only down the barrel — but at whatever is down it, not only at the ship being chased. A
        // gun bolted to a hull shoots where the hull points, so anything hostile that crosses the
        // nose inside range gets fired at, including on the way out of a pass.
        var mark = null;
        var closest = 0.9;

        ships.forEach(function (other) {
            if (!other.alive || other.side === ship.side || other === ship) return;

            var line = [
                other.position[0] - ship.position[0],
                other.position[1] - ship.position[1],
                other.position[2] - ship.position[2]
            ];
            var span = Math.sqrt(dot(line, line)) || 1;
            if (span > 1200 + ship.band[1] * 0.8) return;

            var aligned = dot(forward, [line[0] / span, line[1] / span, line[2] / span]);
            if (aligned > closest) { closest = aligned; mark = other; }
        });

        if (mark) {
            ship.cooldown = 0.22 + Math.random() * 0.5;
            fire(ship, mark);
        }
    }

    function step(dt) {
        station.spin += dt * 0.22;

        // Everything a laser can hit, gathered before anything fires. The positions are the ships'
        // own arrays rather than copies, so a ship that has already moved this frame is where it
        // has moved to.
        refreshSolids();
        ships.forEach(function (ship) { think(ship, dt); });

        // Compacted in place rather than filtered into a new array. Two allocations a frame for
        // sixty frames a second is not a cost worth paying to save four lines.
        var kept = 0;
        var i;

        for (i = 0; i < beams.length; i++) {
            beams[i].life -= dt;
            if (beams[i].life > 0) beams[kept++] = beams[i];
        }
        beams.length = kept;

        kept = 0;
        for (i = 0; i < debris.length; i++) {
            var bit = debris[i];
            bit.life -= dt;
            bit.position[0] += bit.velocity[0] * dt;
            bit.position[1] += bit.velocity[1] * dt;
            bit.position[2] += bit.velocity[2] * dt;
            if (bit.life > 0) debris[kept++] = bit;
        }
        debris.length = kept;
    }

    function draw() {
        if (sky) ctx.drawImage(sky, 0, 0);
        else ctx.clearRect(0, 0, width, height);

        drawWorld();

        // Attitudes and positions as they are now, for the beams to be cut against.
        refreshSolids();

        // Painter's order, because a canvas has no depth buffer: everything back to front, station
        // and ships together so a hull can pass in front of the station and behind another hull.
        var order = ships.filter(function (ship) { return ship.alive; }).map(function (ship) {
            return { z: ship.position[2], ship: ship };
        });
        order.push({ z: station.position[2], ship: null });
        order.sort(function (a, b) { return b.z - a.z; });

        order.forEach(function (entry) {
            if (!entry.ship) { drawStation(); return; }

            var ship = entry.ship;
            var arriving = 1 - ship.arriving / 0.9;
            var mist = fade(ship.position[2]);

            var matrix = orient(ship.yaw, ship.pitch, ship.roll);
            drawHull(ship.model, ship.position, matrix, ship.scale, ship.hull, mist,
                     arriving, false);
        });

        drawBeams();
        drawDebris();
    }

    // ---- the loop ------------------------------------------------------------------------------

    function resize() {
        // Where everything is in the frame, measured before the frame changes. A ship keeps its
        // place in the picture across a resize instead of being thrown out of the side of it —
        // and, unlike relaunching them, without the fight restarting because a window was dragged.
        var held = focal ? ships.map(function (ship) {
            return [screenX(ship.position), screenY(ship.position)];
        }) : null;

        // Two device pixels per logical one at most. Beyond that the detail is finer than a reader
        // can see and the fill rate is spent on a background.
        dpr = Math.min(2, window.devicePixelRatio || 1);

        var box = canvas.getBoundingClientRect();
        width = Math.max(1, Math.round(box.width * dpr));
        height = Math.max(1, Math.round(box.height * dpr));

        canvas.width = width;
        canvas.height = height;

        tall = height > width * 1.3;

        // A field of view that holds the fight in frame on a phone as well as on a monitor. On a
        // tall frame it follows the width, or a phone would be looking at the fight through a
        // letterbox four screens deep.
        focal = (tall ? width * 1.6 : Math.max(width, height)) * 0.62;

        station.position = place(station.frame[0], station.frame[1], station.frame[2]);

        ships.forEach(function (ship, index) {
            if (!held) { launch(ship, index); return; }

            var put = place(held[index][0], held[index][1], ship.position[2]);
            ship.position[0] = put[0];
            ship.position[1] = put[1];
        });

        buildSky();
        buildWorld();
    }

    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var running = false;
    var last = 0;

    function frame(now) {
        if (!running) return;

        // A clamp, not a smoothing: coming back to a tab that has been in the background for ten
        // minutes must not advance the fight by ten minutes in one step.
        var dt = Math.min(0.05, (now - last) / 1000 || 0);
        last = now;

        step(dt);
        draw();
        requestAnimationFrame(frame);
    }

    function start() {
        if (running || still) return;
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
    }

    function stop() { running = false; }

    resize();

    var pending = null;
    window.addEventListener('resize', function () {
        clearTimeout(pending);
        pending = setTimeout(function () {
            resize();
            if (!running) draw();
        }, 200);
    });

    if (still) {
        // One frame, settled: a reader who has asked for no motion still gets the picture, and the
        // few seconds of simulation are what puts the ships somewhere worth looking at.
        for (var i = 0; i < 240; i++) step(1 / 60);
        draw();
        return;
    }

    // Nothing runs while the scene is off screen or the tab is in the background. A hero animation
    // that keeps a laptop's fan on while somebody reads the release notes is a bad advertisement
    // for the thing it is advertising.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting && !document.hidden) start(); else stop();
            });
        }, { threshold: 0 }).observe(canvas);
    } else {
        start();
    }
})();
