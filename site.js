(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const page = document.body.dataset.page || 'home';
  const menuButton = $('.menu-toggle');
  const nav = $('#primary-nav');
  const navLinks = [...document.querySelectorAll('.nav-link')];

  function closeMenu() {
    if (!menuButton || !nav) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('open');
  }

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
      nav.classList.toggle('open', isOpen);
    });
    navLinks.forEach(link => link.addEventListener('click', closeMenu));
  }

  function setActiveNav(sectionId = '') {
    navLinks.forEach(link => {
      const isPageLink = link.dataset.nav === page;
      const isSectionLink = page === 'raven' && sectionId && link.dataset.section === sectionId;
      const active = isSectionLink || (!sectionId && isPageLink);
      link.classList.toggle('active', Boolean(active));
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  setActiveNav();

  if (page === 'raven' && 'IntersectionObserver' in window) {
    const sectionLinks = navLinks.filter(link => link.dataset.section);
    const sectionTargets = sectionLinks.map(link => document.getElementById(link.dataset.section)).filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNav(visible.target.id);
    }, { rootMargin: '-28% 0px -62% 0px', threshold: [0, .08, .2, .4] });
    sectionTargets.forEach(section => observer.observe(section));
  }

  const contactForm = $('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async event => {
      event.preventDefault();
      const status = $('#contact-status');
      const values = new FormData(contactForm);
      status.textContent = 'Saving inquiry…';
      try {
        const response = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.get('name'), email: values.get('email'),
            interest: values.get('interest'), message: values.get('message')
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to save this inquiry.');
        status.textContent = 'Inquiry saved to the demo server. Connect email or CRM routing before launch.';
        contactForm.reset();
      } catch (error) {
        status.textContent = `Could not save: ${error.message}.`;
      }
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
})();
