import Link from 'next/link'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`font-extrabold tracking-tight no-underline ${className}`}
      style={{ fontFamily: "var(--font-syne, 'Syne', sans-serif)", letterSpacing: '-0.5px' }}
    >
      <span className="text-green-400">ENI</span>
      <span className="text-white">GMA</span>
    </Link>
  )
}
