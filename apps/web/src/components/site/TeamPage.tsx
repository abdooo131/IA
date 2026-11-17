import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Arrow, PageHead } from './SiteParts';
import { SiteShell } from './SiteShell';
import { initials, parseTeam } from './team';

// /team ("Our team"): leadership cards from the `site.team.people` messages (team.ts), then a
// short Join us note. A person's photo is a file under public/site/team/; without one the round
// spot shows their initials.

export async function TeamPage() {
  const t = await getTranslations('site.team');
  const people = parseTeam(t.raw('people'));

  return (
    <SiteShell page="team">
      <PageHead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />

      <section className="s-band" aria-label={t('listLabel')}>
        <div className="s-wrap">
          <ul className="s-team">
            {people.map((person, i) => (
              <li key={i} className={person.placeholder ? 's-placeholder' : undefined}>
                {person.photo ? (
                  <img
                    className="s-avatar"
                    src={person.photo}
                    alt=""
                    width={112}
                    height={112}
                    loading="lazy"
                  />
                ) : (
                  <span className="s-avatar" aria-hidden="true">
                    {initials(person.name)}
                  </span>
                )}
                <h2>{person.name}</h2>
                {person.role && <p className="s-role">{person.role}</p>}
                {person.summary && <p className="s-summary">{person.summary}</p>}
                {person.achievements.length > 0 && (
                  <ul className="s-achievements" aria-label={t('achievementsLabel')}>
                    {person.achievements.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="s-band s-alt" id="join">
        <div className="s-wrap s-join">
          <div>
            <span className="s-eyebrow">{t('joinEyebrow')}</span>
            <h2 className="s-mt">{t('joinTitle')}</h2>
            <p className="s-lead s-mt">{t('joinP')}</p>
          </div>
          <div className="s-join-side">
            <ul className="s-chips">
              {(['r1', 'r2', 'r3'] as const).map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
            <Link className="s-more" href="/contact">
              {t('joinCta')}
              <Arrow />
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
