document.addEventListener("DOMContentLoaded", () => {
    // Icons
    lucide.createIcons();

    // Init GSAP
    gsap.registerPlugin(ScrollTrigger);

    // Theme Toggle Logic
    const themeToggle = document.getElementById("themeToggle");
    const htmlEl = document.documentElement;

    themeToggle.addEventListener("click", () => {
        const currentTheme = htmlEl.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        htmlEl.setAttribute("data-theme", newTheme);

        if (newTheme === "light") {
            themeToggle.innerHTML = '<i data-lucide="moon"></i>';
        } else {
            themeToggle.innerHTML = '<i data-lucide="sun"></i>';
        }
        lucide.createIcons();
    });

    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // 1. Hero Pin & Zoom (Perfect pin, smooth scrub)
    const heroTl = gsap.timeline({
        scrollTrigger: {
            trigger: ".apple-hero-wrapper",
            start: "top top",
            end: "+=150%",
            scrub: 1,
            pin: true,
            anticipatePin: 1
        }
    });

    heroTl.to(".hero-bg-apple", { scale: 1.6, opacity: 0.1, duration: 2 }, 0);
    heroTl.to(".w1", { y: -80, opacity: 0, duration: 0.5 }, 0.2);
    heroTl.to(".w2", { y: -80, opacity: 0, duration: 0.5 }, 0.4);
    heroTl.to(".w3", { y: -80, opacity: 0, duration: 0.5 }, 0.6);
    heroTl.to(".hero-sub-apple", { opacity: 0, duration: 0.5 }, 0.8);

    // 2. Cinematic Manifesto Blur Reveal
    gsap.set(".m1", { y: 60, opacity: 0, filter: "blur(15px)", scale: 0.95 });
    gsap.set(".m2", { y: 60, opacity: 0, filter: "blur(15px)", scale: 0.95 });

    const mTl = gsap.timeline({
        scrollTrigger: {
            trigger: ".manifesto-section",
            start: "top 75%",
            end: "center center",
            scrub: 1
        }
    });

    mTl.to(".m1", { y: 0, opacity: 1, filter: "blur(0px)", scale: 1, duration: 1 })
        .to(".m2", { y: 0, opacity: 1, filter: "blur(0px)", scale: 1, duration: 1 }, "-=0.4");

    // 3. Systems Grid Reveal
    gsap.from(".gs-sys-intro", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: {
            trigger: ".systems-section",
            start: "top 80%",
            toggleActions: "play none none reverse"
        }
    });

    gsap.from(".fade-up", {
        y: 20, /* Reduced significantly to prevent massive misalignment gaps during animation */
        opacity: 0,
        stagger: 0.10,
        duration: 0.6,
        ease: "power2.out",
        scrollTrigger: {
            trigger: ".systems-grid",
            start: "top 85%",
            toggleActions: "play none none reverse"
        }
    });

    // 4. Industry Tags Reveal
    gsap.from(".gs-ind-head", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: {
            trigger: ".industries-apple",
            start: "top 85%",
            toggleActions: "play none none reverse"
        }
    });

    const indTags = gsap.utils.toArray(".industry-tag");
    gsap.from(indTags, {
        y: 20,
        opacity: 0,
        stagger: 0.05,
        duration: 0.5,
        ease: "power2.out",
        scrollTrigger: {
            trigger: ".bg-tags-container",
            start: "top 85%",
            toggleActions: "play none none reverse"
        }
    });

    // 5. How It Works Reveal
    gsap.from(".gs-hiw-intro", {
        y: 40, opacity: 0, duration: 0.8, ease: "power2.out",
        scrollTrigger: { trigger: ".hiw-section", start: "top 80%", toggleActions: "play none none reverse" }
    });

    gsap.from(".gs-hiw-step", {
        y: 30, opacity: 0, stagger: 0.15, duration: 0.7, ease: "power2.out",
        scrollTrigger: { trigger: ".hiw-flow", start: "top 85%", toggleActions: "play none none reverse" }
    });

    // 5. Pricing Dynamic Reveal
    if (window.innerWidth > 768) {
        const pTl = gsap.timeline({
            scrollTrigger: {
                trigger: ".pricing-apple",
                start: "top 70%",
                end: "center center",
                scrub: 1
            }
        });

        pTl.to(".d-feat-1", { y: 0, opacity: 1, duration: 1 })
            .to(".d-feat-2", { y: 0, opacity: 1, duration: 1 }, "-=0.5")
            .to(".d-feat-3", { y: 0, opacity: 1, duration: 1 }, "-=0.5");

        gsap.to(".pricing-card-3d", {
            rotateX: 0,
            rotateY: 0,
            boxShadow: "0 10px 40px rgba(59, 130, 246, 0.4)",
            ease: "power2.out",
            scrollTrigger: {
                trigger: ".pricing-apple",
                start: "top 70%",
                end: "center center",
                scrub: 1
            }
        });
    } else {
        gsap.set(".feature-row", { y: 0, opacity: 1 });
    }

    // 6. Contact Form Pop
    gsap.from(".form-pop", {
        scale: 0.95,
        opacity: 0,
        y: 20,
        ease: "power2.out",
        duration: 0.8,
        scrollTrigger: {
            trigger: ".contact-parallax",
            start: "top 80%",
            toggleActions: "play none none none"
        }
    });

    // 6. Lead Capture Form Submission
    // Primary: /api/lead-intake (AI bot + SMS to Nick + Google Sheets)
    // Backup:  Web3Forms (email to Nick — fires in parallel, silent fail OK)
    const authForm = document.getElementById('auditForm');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            const originalText = btn.innerHTML;

            btn.innerHTML = 'Sending Request... <i data-lucide="loader" class="spin"></i>';
            btn.disabled = true;
            lucide.createIcons();

            const formData = new FormData(authForm);
            const object = Object.fromEntries(formData);
            const json = JSON.stringify(object);

            // Fire Web3Forms backup silently (email to Nick) — don't await
            fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: json,
            }).catch(() => {});

            try {
                // Primary: AI lead intake API (SMS + AI bot + Sheets)
                const response = await fetch('/api/lead-intake', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: json,
                });

                const result = await response.json();

                if (response.ok) {
                    btn.innerHTML = '<i data-lucide="check-circle"></i> Audit Requested!';
                    btn.style.background = '#10B981';
                    btn.style.color = '#fff';
                    lucide.createIcons();
                    authForm.reset();
                } else {
                    throw new Error('API error');
                }
            } catch (error) {
                // If the AI API fails, the Web3Forms backup already fired — still show success
                // so the user isn't confused. Log for debugging.
                console.error('lead-intake API error (backup email still sent):', error);
                btn.innerHTML = '<i data-lucide="check-circle"></i> Audit Requested!';
                btn.style.background = '#10B981';
                btn.style.color = '#fff';
                lucide.createIcons();
                authForm.reset();
            }
        });
    }
});
