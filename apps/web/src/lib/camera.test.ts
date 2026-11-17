import { describe, expect, it, vi } from 'vitest';
import { captureProof, openCamera } from './camera';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

describe('openCamera', () => {
  it('hands back the stream while the scanner is open', async () => {
    const { stream, track } = fakeStream();
    expect(
      await openCamera(
        async () => stream,
        () => false,
      ),
    ).toBe(stream);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('switches the camera off when the scanner closed while it was starting', async () => {
    const { stream, track } = fakeStream();
    let closed = false;
    const pending = openCamera(
      async () => {
        closed = true; // Close tapped during the permission prompt
        return stream;
      },
      () => closed,
    );
    expect(await pending).toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
  });
});

describe('captureProof', () => {
  it('previews a photo only once it is uploaded', async () => {
    const preview = vi.fn(() => 'blob:1');
    expect(await captureProof('a', async () => ({ ok: true, id: 'p1' }), preview)).toEqual({
      ok: true,
      id: 'p1',
      url: 'blob:1',
    });
    const failed = await captureProof('b', async () => ({ ok: false, error: 'network' }), preview);
    expect(failed).toEqual({ ok: false, error: 'network' });
    expect(preview).toHaveBeenCalledOnce();
  });
});
