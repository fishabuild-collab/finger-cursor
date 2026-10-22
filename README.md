# finger-cursor

Turn your website's cursor into a 3D telescopic finger pointer, the classroom stick with a rubber hand on the end.

- Rendered with [three.js](https://threejs.org), loaded on demand from a CDN. You don't need to install it.
- The pointer floats above the page and casts a real shadow onto it.
- Click and the fingertip drops onto the glass with a hard plastic "tick" (synthesized with Web Audio, so there are no sound files).

**[Live demo](https://fishabuild-collab.github.io/finger-cursor/)**

## Quick start

```html
<script type="module" src="finger-cursor.js" data-auto></script>
```

Or set it up yourself:

```html
<script type="module">
  import FingerCursor from './finger-cursor.js';

  const cursor = await FingerCursor.init({
    hand: 'point',     // 'point' or 'peace'
    color: '#8fd3ea',  // rubber hand and handle colour
    size: 1,           // overall scale
    angle: -32,        // rod angle on screen, in degrees
    elevation: 26,     // how steeply the rod rises off the screen
    hoverDepth: 1,     // how high it floats (0 = touching)
    tilt: true,        // lean a little as you move
    ripple: true,      // ring on the screen when you tap
    sound: true,       // plastic tap sound
    volume: 0.5,
    three: undefined   // pass your own THREE module to skip the CDN fetch
  });

  cursor.set({ hand: 'peace' }); // change options live
  cursor.disable();              // put the normal cursor back
</script>
```

`data-auto` also reads `data-hand`, `data-color`, `data-size` and `data-sound="off"`.

## How the depth works

A transparent WebGL canvas covers the page. The camera is set up so the page plane maps 1:1 onto screen pixels. The pointer is a real 3D model held above that plane: the fingertip sits under your mouse, and the rod rises off the glass towards you.

- An invisible "page" plane only draws shadows, so the pointer casts a real shadow on your content. A soft contact shadow under the fingertip darkens as it gets closer.
- **Hovering:** the tip floats above the page, so its shadow falls away from it.
- **Tapping:** a spring drops the tip onto the glass and the shadow meets it. The far end of the rod still throws its shadow further away, the same as a real stick held at an angle.
- The tip is moved along the camera ray, so the fingertip always lines up with the real mouse position, even while it's lifted.

On touch devices (no hover pointer), or if WebGL or the CDN isn't available, the library does nothing and the normal cursor stays.

## Demo

Open `index.html` in a browser.

## License

MIT
