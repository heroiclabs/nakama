/**
 * Elderwood RP - Landing Page JavaScript
 * Magical particle effects and animations
 */

// ============================================
// Particle System
// ============================================
class ParticleSystem {
    constructor(container, particleCount = 50) {
        this.container = container;
        this.particleCount = particleCount;
        this.init();
    }

    init() {
        for (let i = 0; i < this.particleCount; i++) {
            this.createParticle(i);
        }
    }

    createParticle(index) {
        const particle = document.createElement('div');
        particle.className = 'particle';

        // Random position
        particle.style.left = Math.random() * 100 + '%';

        // Random size
        const size = Math.random() * 4 + 2;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';

        // Random animation delay and duration
        const delay = Math.random() * 8;
        const duration = Math.random() * 4 + 6;
        particle.style.animationDelay = delay + 's';
        particle.style.animationDuration = duration + 's';

        // Random color variation (gold to purple)
        const hue = Math.random() > 0.7 ? 280 : 45; // Purple or gold
        const saturation = 70 + Math.random() * 30;
        const lightness = 50 + Math.random() * 20;
        particle.style.background = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        particle.style.boxShadow = `0 0 ${size * 2}px hsl(${hue}, ${saturation}%, ${lightness}%)`;

        this.container.appendChild(particle);
    }
}

// ============================================
// Navbar Scroll Effect
// ============================================
function initNavbar() {
    const navbar = document.querySelector('.navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });
}

// ============================================
// Smooth Scroll for Anchor Links
// ============================================
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// ============================================
// Counter Animation
// ============================================
function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');
    const duration = 2000;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target;
                const target = parseInt(counter.getAttribute('data-target'));
                const startTime = performance.now();

                function updateCounter(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);

                    // Easing function (ease-out)
                    const easeOut = 1 - Math.pow(1 - progress, 3);
                    const current = Math.floor(target * easeOut);

                    counter.textContent = current;

                    if (progress < 1) {
                        requestAnimationFrame(updateCounter);
                    }
                }

                requestAnimationFrame(updateCounter);
                observer.unobserve(counter);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

// ============================================
// Fade In Animations on Scroll
// ============================================
function initScrollAnimations() {
    const elements = document.querySelectorAll('.feature-card, .action-card, .section-title, .section-subtitle');

    elements.forEach(el => el.classList.add('fade-in'));

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => observer.observe(el));
}

// ============================================
// Mouse Glow Effect on Cards
// ============================================
function initCardGlow() {
    const cards = document.querySelectorAll('.feature-card, .action-card');

    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
}

// ============================================
// Parallax Effect for Hero
// ============================================
function initParallax() {
    const hero = document.querySelector('.hero');

    window.addEventListener('scroll', () => {
        const scroll = window.pageYOffset;
        const heroHeight = hero.offsetHeight;

        if (scroll < heroHeight) {
            const parallax = scroll * 0.3;
            hero.style.backgroundPositionY = `${parallax}px`;
        }
    });
}

// ============================================
// Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Initialize particle system
    const particlesContainer = document.getElementById('particles');
    if (particlesContainer) {
        new ParticleSystem(particlesContainer, 40);
    }

    // Initialize all components
    initNavbar();
    initSmoothScroll();
    animateCounters();
    initScrollAnimations();
    initCardGlow();
    initParallax();

    // Log initialization
    console.log('✨ Elderwood Landing Page initialized');
});

// ============================================
// Service Worker Registration (optional)
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Can be added later for offline support
    });
}
