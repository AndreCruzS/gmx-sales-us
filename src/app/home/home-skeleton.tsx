// What home looks like before it knows anything.
//
// Until now it looked like a finished screen with nothing in it: the manager home
// mounted with every list empty and every total at zero, so the first thing a
// manager saw on opening the app was "Open pipeline $0 · 0 open deals" and a sales
// bar reading 0 LF. That is not a loading state, it is a wrong answer — and it is
// worse than a slow one, because a zero is a number and the reader has no way to
// know it was a placeholder. Ten seconds later it silently became $180,000.
//
// It also arrived at the wrong screen first. HomeSwitch defaulted to the rep's day
// while the profile resolved, so a manager watched somebody else's diary for a
// beat before their own team replaced it.
//
// So: SHAPE WITHOUT VALUES. Blocks where the figures will be, in the same layout
// at the same sizes, so nothing jumps when the real thing arrives and nothing
// claims a number in the meantime. A reader can see the page is coming and cannot
// mistake any of it for data.
//
// One breath, not a shimmer. This app has one motion curve and a sweeping
// gradient would be the only thing on the screen moving sideways — see .skel.

/** A block standing in for something not known yet. */
function Skel({
  w,
  h,
  className,
}: {
  w?: string;
  h: number;
  className?: string;
}) {
  return (
    <span
      className={`skel${className ? ` ${className}` : ""}`}
      style={{ width: w ?? "100%", height: h }}
    />
  );
}

/**
 * The manager's home, unanswered.
 *
 * Deliberately not a generic spinner: the sections are the ones that are about to
 * appear, in their real order and at their real heights, because the point of a
 * skeleton is that the page does not move when it fills.
 */
export function ManagerHomeSkeleton({ name }: { name?: string }) {
  return (
    <div className="stack pt-2" aria-busy="true">
      {/* The greeting is the one thing already known — the name came off the
          cached profile, and hiding it behind a grey block to be consistent would
          be consistency at the reader's expense. */}
      <section>
        {name ? (
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            Hello, {name}
          </h1>
        ) : (
          <Skel w="62%" h={30} />
        )}
        <Skel w="80%" h={13} className="mt-2" />
      </section>

      {/* The two tiles. Same 2-up grid and the same figure height, so the real
          numbers land exactly where these blocks were. */}
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="card p-4">
            <Skel w="58%" h={11} />
            <Skel w="76%" h={21} className="mt-2" />
            <Skel w="46%" h={11} className="mt-2" />
          </div>
        ))}
      </div>

      {/* The sales dashboard: heading, the four lens chips, then a card with the
          counter, the bar and its rows. */}
      <section>
        <div className="section-head">
          <Skel w="40%" h={14} />
        </div>
        <div className="chip-row mb-3" aria-hidden="true">
          {[64, 52, 96, 68].map((w, i) => (
            <Skel key={i} w={`${w}px`} h={36} className="skel-pill" />
          ))}
        </div>
        <div className="card p-4">
          <Skel w="54%" h={15} />
          <Skel h={26} className="mt-2 skel-bar" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel-row">
              <Skel w="4px" h={26} className="skel-rail" />
              <span className="min-w-0 flex-1">
                <Skel w={i === 0 ? "52%" : i === 1 ? "44%" : "36%"} h={14} />
                <Skel w="30%" h={11} className="mt-1" />
              </span>
              <Skel w="72px" h={14} />
            </div>
          ))}
        </div>
      </section>

      {/* Enough of the sections below to say the page continues, without pretending
          to know how many rows each of them has. */}
      <section>
        <div className="section-head">
          <Skel w="46%" h={14} />
        </div>
        <div className="card p-4">
          {[0, 1].map((i) => (
            <div key={i} className={i > 0 ? "mt-4" : undefined}>
              <Skel w="58%" h={14} />
              <Skel h={8} className="mt-2 skel-bar" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Home before we know WHOSE home it is.
 *
 * Shown for the length of a profile lookup and no longer: the provider reports
 * that it has finished whether it succeeded or not, so this can never be the last
 * thing on screen. Capture is unaffected — the + button lives in the nav bar,
 * outside this tree, which is what keeps the offline promise (D56) intact while
 * still not guessing the role.
 */
export function HomeBootSkeleton() {
  return <ManagerHomeSkeleton />;
}
