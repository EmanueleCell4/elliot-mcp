// Policy pages for the ELLIOT Score site: privacy, terms, disclosure.
// Kept apart from build-site.mjs so the home page can be redesigned without touching them.
// Plain-language drafts: have them reviewed by a lawyer before relying on them.

const CONTACT = "cellaemanuele05@gmail.com";
const OPERATOR = "Emanuele Cella, Rome, Italy";
const UPDATED = "28 October 2026";

const section = (title, html) => `<h2>${title}</h2>${html}`;

export const legalPages = (repo) => [
  {
    path: "privacy.html",
    title: "ELLIOT Privacy Policy",
    desc: "What data the ELLIOT Score collects, why, and who processes it.",
    body: `<div class="label">Privacy</div><h1>Privacy policy</h1><p class="lead">Last updated ${UPDATED}. ELLIOT is operated by ${OPERATOR} (the "operator"). Contact: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
${section("The short version", `<p>This site has no accounts, no cookies, no analytics and no trackers. ELLIOT analyses public source code, not people.</p>`)}
${section("What we process", `<ul>
<li><b>Score requests.</b> A request is a public GitHub issue on <a href="https://github.com/${repo}">github.com/${repo}</a>. It contains the repository you submitted and your public GitHub username. GitHub processes it under <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">its own privacy statement</a>.</li>
<li><b>Public repositories.</b> To score a repository, ELLIOT reads its public files at one commit. That code may contain names or emails of its authors (for example in commit metadata or docs); ELLIOT doesn't extract or publish them.</li>
<li><b>Score records.</b> Public: repository name, commit, date, score and counts of findings. No personal data.</li>
<li><b>Full reports.</b> Stored encrypted and shared only with the repository's maintainers on request.</li>
<li><b>Email.</b> If you write to us, we keep your message to answer it.</li>
</ul>`)}
${section("Who else processes data", `<ul>
<li><b>GitHub</b> (hosting of this site, the repository, issues and the scoring workflow). GitHub may log visits to this site, such as IP addresses, as part of running GitHub Pages.</li>
<li><b>Anthropic</b> (the AI model that reads the public code during an audit). Only repository content is sent, not information about the person who requested the score.</li>
</ul>`)}
${section("Legal basis and your rights", `<p>We process this data on the basis of our legitimate interest in publishing verifiable, independent analysis of public software (Art. 6(1)(f) GDPR). You can ask to access, correct or delete personal data we hold about you, or object to its processing, by writing to <a href="mailto:${CONTACT}">${CONTACT}</a>. You can also complain to your data protection authority; in Italy, the <a href="https://www.garanteprivacy.it">Garante per la protezione dei dati personali</a>.</p>`)}
${section("Retention", `<p>Score records are kept as long as the score is published. Encrypted full reports are kept for 24 months, then deleted. Emails are kept as long as needed to handle the request.</p>`)}`,
  },
  {
    path: "terms.html",
    title: "ELLIOT Terms of Use",
    desc: "The terms for using the ELLIOT Score site, scores and badges.",
    body: `<div class="label">Terms</div><h1>Terms of use</h1><p class="lead">Last updated ${UPDATED}. These terms cover this site, ELLIOT scores, badges and reports, operated by ${OPERATOR}.</p>
${section("What a score is", `<p>An ELLIOT Score is the result of an automated analysis of a repository's public documentation and code at one specific commit, checked by an independent automated reviewer, using the method described on <a href="method.html">How the score works</a>. It is a statement about whether documented promises are reflected in that code, at that commit. It is not a security audit, a certification, a guarantee, or a statement about the people or company behind a project.</p>`)}
${section("No warranty", `<p>Scores, badges and reports are provided "as is", without warranty of any kind. Automated analysis can be wrong. Don't rely on a score as your only basis for a security, purchase or legal decision. To the extent permitted by law, the operator is not liable for decisions made on the basis of a score.</p>`)}
${section("Corrections and disputes", `<p>If you believe a score is wrong, request a re-check from the project's page, or write to <a href="mailto:${CONTACT}">${CONTACT}</a>. Disputed findings are re-read, and scores are corrected or withdrawn when the analysis was wrong. Maintainers can also ask for their repository's score to be re-computed after a fix.</p>`)}
${section("Using the service", `<ul>
<li>Submit only public repositories. Don't use the service to overload it, to probe it, or to attempt to influence an audit (for example by planting instructions for the AI in a repository). Attempts to manipulate a score void that score.</li>
<li>A score can't be bought. Paid plans, if offered, buy speed and private repositories, never a different result.</li>
</ul>`)}
${section("Badges and the ELLIOT name", `<p>You may display the badge for your own repository's current score, linked to its ELLIOT page. Don't alter a badge, show an outdated or someone else's score as your own, or imply ELLIOT endorses a product. "ELLIOT" and the robot image are the operator's.</p>`)}
${section("Law", `<p>These terms are governed by Italian law, without prejudice to mandatory consumer protections in your country.</p>`)}`,
  },
  {
    path: "disclosure.html",
    title: "ELLIOT Disclosure Policy",
    desc: "How ELLIOT handles broken promises and security findings responsibly.",
    body: `<div class="label">Disclosure</div><h1>Disclosure policy</h1><p class="lead">Last updated ${UPDATED}. A public score should never put a project's users at risk. This is how ELLIOT handles what it finds.</p>
${section("What is public", `<p>For every scored repository: the score, the commit checked, and the number of confirmed broken promises by severity (high, medium, low). Never the details of a finding that hasn't been fixed.</p>`)}
${section("What goes to maintainers first", `<p>Full reports, with every finding traced to the file and line, are shared privately with a repository's maintainers on request (<a href="mailto:${CONTACT}">${CONTACT}</a>, subject "ELLIOT Score report", from an address or account that shows you maintain the project). Security-relevant findings may also be reported through the project's own security policy or private vulnerability reporting.</p>`)}
${section("When details become public", `<p>Details of a finding are published only after the maintainers have fixed it, or with their agreement. If a high-severity issue stays unfixed for 90 days after the maintainers were told, we may publish a short, non-exploitable description, after giving them notice.</p>`)}
${section("Re-checks", `<p>When a project fixes a broken promise, it can request a re-check. The new commit is scored again, and the page shows the new score.</p>`)}
${section("Report a problem with ELLIOT itself", `<p>See <a href="https://github.com/${repo}/blob/main/SECURITY.md">SECURITY.md</a>.</p>`)}`,
  },
];
