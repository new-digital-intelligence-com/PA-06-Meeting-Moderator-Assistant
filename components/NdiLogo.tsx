/**
 * NDI's logo, as NDI's own site draws it (fo01-ndi): "NDI" in heavy red capitals (#fe0100,
 * Archivo Black — the font-logo family, app/layout.tsx) over "NEW DIGITAL INTELLIGENCE" in
 * black, exactly as wide as the letters. Without the tagline it is the letters alone, for a
 * header where the tagline would be too small to read. Size it with a height, e.g.
 * className="h-3.5 w-auto".
 */
export default function NdiLogo({ tagline = true, className = "" }: { tagline?: boolean; className?: string }) {
  return (
    <svg viewBox={tagline ? "0 0 184 106" : "0 0 184 72"} overflow="visible" role="img" aria-label="NDI – New Digital Intelligence" className={className}>
      <text x="0" y="72" fontSize="99" textLength="184" lengthAdjust="spacingAndGlyphs" fill="#fe0100" className="font-logo">
        NDI
      </text>
      {tagline && (
        <text x="4" y="104" fontSize="11.3" fontWeight="700" textLength="176" lengthAdjust="spacing" fill="#000000" fontFamily="Arial, Helvetica, sans-serif">
          NEW DIGITAL INTELLIGENCE
        </text>
      )}
    </svg>
  );
}
