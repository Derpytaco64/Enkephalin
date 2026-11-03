'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/app/_components/avatar';
import { IMAGE_LIMIT, NAME_LIMIT } from '@/lib/account/shape';
import type { Result } from '@/lib/drugs/mutations';

/** How wide the stored square is. See `lib/account/shape.ts` on why it is small. */
const SIDE = 160;

/**
 * The name shown instead of your email, and the picture in the header.
 *
 * The picture is resized **here**, in the browser, before it is sent: a phone
 * camera's 4000px JPEG is four megabytes, and the thing it has to become is a
 * 160px square. Resizing on the server would mean carrying that four megabytes
 * through a server action and adding an image decoder to a project that has no
 * other use for one, to produce a result the browser can produce exactly as
 * well with a canvas it already has.
 *
 * One Save for both fields, because a picture is chosen and a name corrected
 * in the same visit and two buttons would mean two visits or a lost change.
 */
export function ProfileForm({
  user,
  save,
}: {
  user: { name: string | null; email: string; image: string | null };
  save: (input: { name: string; image?: string | null }) => Promise<Result>;
}) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user.name ?? '');
  // Undefined means untouched, which is different from null: null is a
  // deliberate removal, and the action distinguishes them.
  const [image, setImage] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const shown = image === undefined ? user.image : image;

  const choose = async (chosen: File) => {
    setError(null);
    setSaved(false);
    try {
      setImage(await square(chosen, SIDE));
    } catch {
      setError('That file could not be read as an image.');
    }
    // Cleared so that picking the same file again, after a Remove, still
    // fires a change event.
    if (file.current) file.current.value = '';
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await save({ name, image });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    setImage(undefined);
    // Re-renders the layout as well as this page, which is how the header's
    // avatar catches up without invalidating any other path.
    router.refresh();
  };

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';
  const button = 'rounded-full border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60';

  return (
    <form onSubmit={submit} className="mt-4 rounded border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar user={{ ...user, image: shown }} size={80} />

        <div className="flex flex-wrap gap-2">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void choose(chosen);
            }}
          />
          <button type="button" className={button} onClick={() => file.current?.click()}>
            {shown ? 'Change picture' : 'Choose a picture'}
          </button>
          {shown && (
            <button
              type="button"
              className={button}
              onClick={() => { setImage(null); setSaved(false); }}
            >
              Remove picture
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Cropped to a {SIDE}×{SIDE} square in your browser before it is sent, and stored on your
        own row rather than in a file — so it rides along in the{' '}
        <span className="font-mono">/admin/data</span> backup.
      </p>

      <div className="mt-4 max-w-xs">
        <label htmlFor="name" className="text-sm font-medium">Display name</label>
        <input
          id="name" value={name} maxLength={NAME_LIMIT} className={control}
          placeholder={user.email.split('@')[0]}
          onChange={(event) => { setName(event.target.value); setSaved(false); }}
        />
        {/* Said rather than implied, since the field starts empty for
            everyone: registration never asked for a name. */}
        <p className="mt-1 text-xs text-[var(--muted)]">
          Leave it empty to be shown as your email.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {error !== null && <span className="text-sm text-[var(--danger)]">{error}</span>}
        {saved && error === null && <span className="text-sm text-[var(--ok)]">Saved.</span>}
      </div>
    </form>
  );
}

/**
 * The chosen file as a centre-cropped square data URL.
 *
 * Centre-cropped rather than letterboxed, because the result is drawn in a
 * circle: bars at the sides of a squashed photograph become crescents, and a
 * face shrunk to fit inside a 160px box is a face nobody can recognise at
 * 32px in the header.
 *
 * WebP first, falling back to JPEG. Every browser that can run this decodes
 * WebP, but Safari was late to *encoding* it, and `toDataURL` answers a format
 * it cannot write by silently handing back a PNG -- which for a photograph is
 * several times the size. Checking the prefix catches that rather than
 * trusting the request.
 */
async function square(file: File, side: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');

  const crop = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop,
    0, 0, side, side,
  );
  bitmap.close();

  const webp = canvas.toDataURL('image/webp', 0.85);
  const out = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);

  // The server refuses anything over this too; failing here says why while
  // the file picker is still the thing in mind.
  if (out.length > IMAGE_LIMIT) throw new Error('too large');
  return out;
}
