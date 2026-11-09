/** Temporary Shiply wordmark in the brand font, until the new logo files are added. */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Shiply">
      Shiply<i aria-hidden="true" />
    </span>
  );
}
