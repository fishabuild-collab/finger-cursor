# finger-cursor

Turn your website's cursor into a telescopic finger pointer, the little stick with a rubber hand on the end.

- A soft shadow sits under the pointer so it looks like it's floating above the screen.
- Click and it taps the glass: the pointer dips, the shadow slides in under the fingertip, and you hear a small "tok".
- One file, no dependencies, no images or audio files. Everything is inline SVG and Web Audio.

## Quick start

```html
<script src="finger-cursor.js" data-auto></script>
```

Or set it up yourself:

```html
<script src="finger-cursor.js"></script>
<script>
  const cursor = FingerCursor.init({
    hand: 'point',     // 'point' or 'peace'
    color: '#8fd3ea',  // rubber hand and handle colour
    size: 1,           // overall scale
    angle: -32,        // rod angle in degrees
    hoverDepth: 1,     // how high it floats (0 = touching)
    tilt: true,        // lean a little as you move
    ripple: true,      // ring on the screen when you tap
    sound: true,       // tap sound
    volume: 0.5
  });

  cursor.set({ hand: 'peace' }); // change options live
  cursor.disable();              // put the normal cursor back
</script>
```

`data-auto` also reads `data-hand`, `data-color`, `data-size` and `data-sound="off"`.

## How the depth works

The pointer and its shadow are the same SVG drawn twice. The shadow copy is turned black, blurred and offset down-right.

- **Hovering:** large offset, more blur, lighter shadow.
- **Tapping:** the offset drops to almost zero so the shadow meets the fingertip, the blur tightens, and the pointer shrinks a little as it moves "into" the screen.

The shadow is also scaled up slightly around the fingertip. Even while the tip touches the screen, the far end of the rod still throws its shadow further away, the same as a real stick held at an angle. A spring animates the depth, so taps land fast and lift off softly.

On touch devices (no hover pointer) the library does nothing and the normal behaviour is left alone.

## Demo

Open `index.html` in a browser.

## License

MIT
