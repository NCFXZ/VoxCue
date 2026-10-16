import voxcueLogo from '../assets/voxcue.png';

export function AppLogo({ size = 22 }: { size?: number }) {
  return (
    <img
      src={voxcueLogo}
      className="app-logo"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
    />
  );
}
