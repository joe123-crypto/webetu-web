"use client";

import { useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Developer's WhatsApp number in wa.me form: digits only, no "+" or spaces. */
const WHATSAPP_NUMBER = "213563719936";

/** Prefilled so the chat opens with context. The user can edit or clear it. */
const GREETING = "Hey, I'm having a problem with AWRS";

const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(GREETING)}`;

/**
 * WhatsApp's own glyph, inlined because lucide ships no brand icons. Sized in
 * CSS rather than through props, the way the lucide icons elsewhere are.
 */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * A direct line to the developer, docked to the right of every page.
 *
 * Nothing else in the app tells a stuck user where to go — the privacy policy
 * asks them to "contact us" and sign-in failures mention support, neither with
 * an address. This button is that address.
 *
 * It stays collapsed to a bare icon so it never competes with the page, and
 * the arrow tab opens the one sentence that explains what it is for. The arrow
 * is a real click rather than a hover, because most of the traffic is on
 * phones, where there is no hover to reveal anything.
 */
export function WhatsAppButton() {
  const [open, setOpen] = useState(false);
  const labelId = useId();

  return (
    <div className="whatsapp-rail" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="whatsapp-toggle"
        aria-expanded={open}
        aria-controls={labelId}
        aria-label={open ? "Hide the WhatsApp message" : "Show the WhatsApp message"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
      </button>
      {/* The label sits inside the link so the sentence is clickable too, but
          keeps the id, since it is the part that gets shown and hidden. */}
      <a
        className="whatsapp-link"
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Talk to the developer on WhatsApp"
      >
        <span id={labelId} className="whatsapp-label" hidden={!open}>
          Have a problem? Talk to the developer directly
        </span>
        <WhatsAppIcon />
      </a>
    </div>
  );
}
