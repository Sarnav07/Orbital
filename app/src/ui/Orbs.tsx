// Blurred floating token orbs, as behind Uniswap's landing swap. Kept free of viem so
// the landing page and docs can use it without loading the wallet stack.
const ORB_LOGOS = ["/tokens/usdt.png", "/tokens/dai.png", "/tokens/usdc.png"];

export function Orbs({ fixed = false }: { fixed?: boolean }) {
  return <div className={fixed ? "uni-orbs fixed" : "uni-orbs"} aria-hidden="true">
    {ORB_LOGOS.map((logo, index) => <img key={logo} src={logo} alt="" className={`uni-orb uni-orb-${index + 1}`} />)}
    <span className="uni-orb uni-orb-glow-1" /><span className="uni-orb uni-orb-glow-2" /><span className="uni-orb uni-orb-glow-3" />
  </div>;
}
