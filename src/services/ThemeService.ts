import { api } from '../api';

export const ThemeService = {
    async loadTheme() {
        try {
            if (api.getThemeCss) {
                const css = await api.getThemeCss();
                if (css) {
                    const styleId = 'matugen-theme';
                    let styleTag = document.getElementById(styleId);
                    if (!styleTag) {
                        styleTag = document.createElement('style');
                        styleTag.id = styleId;
                        document.head.appendChild(styleTag);
                    }
                    styleTag.textContent = css;
                    console.log('Loaded Matugen theme');
                    return true;
                }
            }
        } catch (e) {
            console.error('Failed to load theme', e);
        }
        return false;
    },

    init() {
        const updateIcon = () => {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (api.setIcon) {
                api.setIcon(isDark ? 'dark' : 'light');
            }
        };

        // Initial call
        updateIcon();

        // Listen for changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateIcon);
    }
};
