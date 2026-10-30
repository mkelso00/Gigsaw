import { ImageResponse } from "next/og";

// The home screen icon on iPhones (and the picture on phone notifications).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#15181c",
      }}
    >
      <svg width="132" height="132" viewBox="12 12 40 40">
        <path d="M17 17h12.5a5.5 5.5 0 1 1 9 0H47v12.5a5.5 5.5 0 1 0 0 9V47H34.5a5.5 5.5 0 1 1-9 0H17z" fill="#22c7a6" />
      </svg>
    </div>,
    size,
  );
}
