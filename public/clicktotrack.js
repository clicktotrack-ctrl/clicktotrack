(function() {
  'use strict';

  // 1. Locate current script element and extract data-site-id
  const currentScript = document.currentScript || document.querySelector('script[data-site-id]');
  const siteId = currentScript ? currentScript.getAttribute('data-site-id') : null;

  if (!siteId) {
    console.warn('[ClicktoTrack] Warning: Missing data-site-id attribute on script tag.');
  }

  // Determine API endpoint
  let apiHost = '';
  if (currentScript && currentScript.src) {
    try {
      const scriptUrl = new URL(currentScript.src);
      apiHost = scriptUrl.origin;
    } catch (e) {
      apiHost = window.location.origin;
    }
  } else {
    apiHost = window.location.origin;
  }

  const TRACKING_ENDPOINT = `${apiHost}/api/v1/track`;

  // 2. Cookie & LocalStorage Helpers (90-day retention)
  function setCookie(name, value, days = 90) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
    try {
      localStorage.setItem(`_ct_${name}`, value);
    } catch (e) {}
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (match) return decodeURIComponent(match);
    try {
      return localStorage.getItem(`_ct_${name}`) || null;
    } catch (e) {
      return null;
    }
  }

  // 3. Extract Click IDs from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const clickIds = ['gclid', 'fbclid', 'msclkid', 'ttclid'];

  clickIds.forEach(id => {
    const value = urlParams.get(id);
    if (value) {
      setCookie(id, value);
    }
  });

  // 4. Retrieve GA4 Client ID & Session ID
  function getGa4Identifiers() {
    let clientId = null;
    let sessionId = null;

    // GA Client ID from _ga cookie
    const gaCookie = getCookie('_ga');
    if (gaCookie) {
      const parts = gaCookie.split('.');
      if (parts.length >= 4) {
        clientId = `${parts}.${parts}`;
      }
    }

    // GA Session ID from _ga_<CONTAINER_ID> cookie
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
      if (cookie.startsWith('_ga_')) {
        const value = cookie.split('=');
        if (value) {
          const parts = value.split('.');
          if (parts.length >= 3) {
            sessionId = parts;
            break;
          }
        }
      }
    }

    return { clientId, sessionId };
  }

  // 5. Send Tracking Payload to Backend API
  function sendTrackEvent(eventName, eventData = {}) {
    if (!siteId) return;

    const { clientId, sessionId } = getGa4Identifiers();

    const payload = {
      siteId: siteId,
      eventName: eventName,
      gclid: getCookie('gclid') || undefined,
      fbclid: getCookie('fbclid') || undefined,
      msclkid: getCookie('msclkid') || undefined,
      clientId: clientId || undefined,
      sessionId: sessionId || undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      ...eventData
    };

    const blobPayload = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACKING_ENDPOINT, blobPayload);
    } else {
      fetch(TRACKING_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(err => console.error('[ClicktoTrack] Track error:', err));
    }
  }

  // 6. Form Submission Interception & PII Capture
  document.addEventListener('submit', function(event) {
    const form = event.target;
    if (!form || form.tagName !== 'FORM') return;

    let email = null;
    let phone = null;

    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      const name = (input.name || input.id || '').toLowerCase();
      const type = (input.type || '').toLowerCase();
      const val = input.value ? input.value.trim() : '';

      if (!val) return;

      if (type === 'email' || name.includes('email') || name.includes('mail')) {
        email = val;
      } else if (type === 'tel' || name.includes('phone') || name.includes('mobile') || name.includes('tel')) {
        phone = val;
      }
    });

    if (email || phone) {
      sendTrackEvent('generate_lead', {
        email: email || undefined,
        phone: phone || undefined
      });
    }
  }, true);

  window.ClicktoTrack = {
    track: sendTrackEvent,
    getClickIds: () => ({
      gclid: getCookie('gclid'),
      fbclid: getCookie('fbclid'),
      msclkid: getCookie('msclkid')
    })
  };

  console.log('[ClicktoTrack] Tag active for siteId:', siteId);
})();
