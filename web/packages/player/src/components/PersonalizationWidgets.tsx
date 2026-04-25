import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  Gift,
  Megaphone,
  Scroll,
  Shield,
  Sparkles,
  Tag,
  Trophy,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import type {
  BannerBlock,
  OfferBlock,
  PersonalMessage,
  RecommendedBlock,
} from "../hooks/use-personalization";

/* ------------------------------------------------------------------ */
/*  HeroBanner                                                         */
/* ------------------------------------------------------------------ */

const VARIANT_GRADIENT: Record<string, string> = {
  event: "from-sky-600 to-indigo-700",
  promo: "from-amber-500 to-orange-600",
  comeback: "from-emerald-500 to-teal-600",
  season: "from-violet-600 to-purple-700",
};

const VARIANT_ICON: Record<string, React.ElementType> = {
  event: Calendar,
  promo: Tag,
  comeback: Gift,
  season: Trophy,
};

export function HeroBanner({ banner }: { banner: BannerBlock }) {
  const gradient = VARIANT_GRADIENT[banner.variant] ?? VARIANT_GRADIENT.promo;
  const Icon = VARIANT_ICON[banner.variant] ?? Sparkles;

  return (
    <Link
      to={banner.link}
      className={cn(
        "group relative block overflow-hidden rounded-xl bg-gradient-to-r p-5 text-white shadow-lg transition-transform hover:scale-[1.01]",
        gradient,
      )}
    >
      <div className="absolute -right-6 -top-6 opacity-10">
        <Icon size={120} />
      </div>
      <div className="relative z-10 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider opacity-80">
          {banner.variant === "comeback" ? "Welcome Back" : "Featured"}
        </p>
        <h3 className="text-lg font-bold leading-tight sm:text-xl">
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p className="text-sm opacity-90">{banner.subtitle}</p>
        )}
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur transition-colors group-hover:bg-white/30">
          {banner.cta}
          <ArrowRight size={12} />
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  RecommendedActivities                                              */
/* ------------------------------------------------------------------ */

const REC_ICON: Record<string, React.ElementType> = {
  calendar: Calendar,
  scroll: Scroll,
  shield: Shield,
  trophy: Trophy,
  gift: Gift,
  tag: Tag,
};

export function RecommendedActivities({
  items,
}: {
  items: RecommendedBlock[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Recommended for You
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => {
          const Icon = REC_ICON[item.icon ?? ""] ?? Sparkles;
          return (
            <Link
              key={item.id}
              to={item.link}
              className="flex min-w-[140px] shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <Icon size={20} className="text-primary" />
              <span className="text-xs font-medium">{item.label}</span>
              {item.description && (
                <span className="line-clamp-2 text-[10px] text-muted-foreground">
                  {item.description}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PersonalMessages                                                   */
/* ------------------------------------------------------------------ */

export function PersonalMessages({
  messages,
}: {
  messages: PersonalMessage[];
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visible = messages.filter((_, i) => !dismissed.has(i));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((msg) => {
        const idx = messages.indexOf(msg);
        return (
          <div
            key={idx}
            className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3"
          >
            <Megaphone size={16} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{msg.title}</p>
              {msg.body && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {msg.body}
                </p>
              )}
            </div>
            <button
              onClick={() =>
                setDismissed((s) => new Set(s).add(idx))
              }
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PersonalizedOffersBanner  (for Store page)                         */
/* ------------------------------------------------------------------ */

export function PersonalizedOffersBanner({
  offers,
}: {
  offers: OfferBlock[];
}) {
  if (offers.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
        <Sparkles className="h-5 w-5 text-amber-400" />
        For You
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="relative flex min-w-[180px] shrink-0 flex-col items-center gap-2 rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-4 text-center"
          >
            {offer.badge && (
              <span className="absolute -top-2 right-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                {offer.badge}
              </span>
            )}
            <Tag size={24} className="text-primary/60" />
            <span className="line-clamp-2 text-sm font-semibold">
              {offer.name}
            </span>
            {offer.discount != null && offer.discount > 0 && (
              <span className="text-xs font-bold text-green-500">
                {offer.discount}% OFF
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
