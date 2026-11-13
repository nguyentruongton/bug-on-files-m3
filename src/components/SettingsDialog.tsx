import React from 'react';
import { ScrollArea, Slider, Switch } from '@bug-on/m3-expressive';
import { ExpressiveShape } from './ExpressiveShape';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { useAppTheme } from '../contexts/AppThemeContext';
import { PRESET_SEED_COLORS } from '../utils/themeUtils';

interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
    showHiddenFiles: boolean;
    onToggleHiddenFiles: () => void;
    iconSize: number;
    onIconSizeChange: (size: number) => void;
    viewMode: 'grid' | 'list';
    onViewModeChange: (mode: 'grid' | 'list') => void;
    filledIcons: boolean;
    onToggleFilledIcons: () => void;
}

const THEME_MODES = [
    { value: 'system', label: 'System', icon: 'brightness_auto' },
    { value: 'light', label: 'Light', icon: 'light_mode' },
    { value: 'dark', label: 'Dark', icon: 'dark_mode' },
] as const;

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
    open,
    onClose,
    showHiddenFiles,
    onToggleHiddenFiles,
    iconSize,
    onIconSizeChange,
    viewMode,
    onViewModeChange,
    filledIcons,
    onToggleFilledIcons,
}) => {
    const {
        themeMode,
        setThemeMode,
        sourceColor,
        setSourceColor,
        useMatugen,
        setUseMatugen,
        matugenDetected,
        matugenSeedColor,
        effectiveSeedColor,
        customCssPath,
        importCustomCss,
        clearCustomCss,
    } = useAppTheme();

    const handlePickColor = (hex: string) => {
        if (useMatugen) {
            setUseMatugen(false);
        }
        setSourceColor(hex);
    };

    return (
        <Dialog
            title="Settings"
            icon={<Icon name="tune" size={24} />}
            open={open}
            onClose={onClose}
            maxWidth="max-w-lg"
            actions={
                <Button onClick={onClose} variant="filled">
                    Done
                </Button>
            }
        >
            <ScrollArea className="max-h-[68vh] pr-2" type="hover">
                <div className="flex flex-col gap-6 py-1">
                    {/* Section 1: Theme & Dynamic Color */}
                    <section className="flex flex-col gap-4 rounded-m3-lg bg-m3-surface-container-high/60 p-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-m3-primary text-xs font-semibold uppercase tracking-wider">
                                <Icon name="palette" size={16} filled />
                                <span>Theme &amp; Dynamic Color</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container text-[11px] font-medium">
                                Active: {effectiveSeedColor}
                            </span>
                        </div>

                        {/* Appearance Mode */}
                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium text-m3-on-surface">
                                Appearance Mode
                            </span>
                            <div className="grid grid-cols-3 gap-2">
                                {THEME_MODES.map((m) => (
                                    <Button
                                        key={m.value}
                                        colorStyle={themeMode === m.value ? 'filled' : 'outlined'}
                                        size="sm"
                                        icon={<Icon name={m.icon} size={18} />}
                                        onClick={() => setThemeMode(m.value)}
                                        className="w-full justify-center"
                                    >
                                        {m.label}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {/* Matugen Sync */}
                        <div className="flex items-center justify-between gap-4 pt-1 border-t border-m3-outline-variant/40">
                            <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-sm font-medium text-m3-on-surface">
                                    Sync with Matugen
                                </span>
                                <span className="text-xs text-m3-on-surface-variant truncate">
                                    {matugenDetected && matugenSeedColor
                                        ? `Synced from system: ${matugenSeedColor}`
                                        : 'No system Matugen/theme palette found'}
                                </span>
                            </div>
                            <Switch
                                checked={useMatugen}
                                onCheckedChange={setUseMatugen}
                                ariaLabel="Sync colors with Matugen"
                            />
                        </div>

                        {/* Seed Color Palette */}
                        <div className="flex flex-col gap-2.5 pt-1 border-t border-m3-outline-variant/40">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-m3-on-surface">
                                    Accent Seed Color
                                </span>
                                <label className="inline-flex items-center gap-2 text-xs text-m3-on-surface-variant cursor-pointer">
                                    <span>Custom</span>
                                    <input
                                        type="color"
                                        value={sourceColor}
                                        onChange={(e) => handlePickColor(e.target.value)}
                                        aria-label="Custom source seed color"
                                        className="w-7 h-7 rounded-full border border-m3-outline-variant bg-transparent cursor-pointer p-0.5"
                                    />
                                </label>
                            </div>

                            <div className="flex flex-wrap items-center gap-2.5">
                                {PRESET_SEED_COLORS.map((preset) => {
                                    const isActive =
                                        !useMatugen &&
                                        sourceColor.toUpperCase() === preset.hex.toUpperCase();
                                    return (
                                        <button
                                            key={preset.hex}
                                            type="button"
                                            title={`${preset.name} (${preset.hex})`}
                                            aria-label={`Select ${preset.name}`}
                                            onClick={() => handlePickColor(preset.hex)}
                                            className={`relative rounded-full p-0.5 transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary ${
                                                isActive ? 'scale-110 ring-2 ring-m3-on-surface' : 'hover:scale-105'
                                            }`}
                                        >
                                            <ExpressiveShape
                                                shape={isActive ? 'flower' : 'circle'}
                                                morphTo="flower"
                                                morphOn="hover"
                                                width={32}
                                                height={32}
                                                style={{ backgroundColor: preset.hex }}
                                                className="text-white shadow-xs"
                                            >
                                                {isActive && <Icon name="check" size={16} />}
                                            </ExpressiveShape>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    {/* Section 2: Explorer & Layout */}
                    <section className="flex flex-col gap-4 rounded-m3-lg bg-m3-surface-container-high/60 p-4">
                        <div className="flex items-center gap-2 text-m3-primary text-xs font-semibold uppercase tracking-wider">
                            <Icon name="grid_view" size={16} filled />
                            <span>Explorer &amp; Layout</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium text-m3-on-surface">
                                Default View Mode
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    colorStyle={viewMode === 'grid' ? 'filled' : 'outlined'}
                                    size="sm"
                                    icon={<Icon name="grid_view" size={18} />}
                                    onClick={() => onViewModeChange('grid')}
                                    className="w-full justify-center"
                                >
                                    Grid
                                </Button>
                                <Button
                                    colorStyle={viewMode === 'list' ? 'filled' : 'outlined'}
                                    size="sm"
                                    icon={<Icon name="view_list" size={18} />}
                                    onClick={() => onViewModeChange('list')}
                                    className="w-full justify-center"
                                >
                                    List
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 pt-1 border-t border-m3-outline-variant/40">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-m3-on-surface">
                                    Grid Icon Size
                                </span>
                                <span className="text-xs font-semibold text-m3-primary">
                                    {iconSize}px
                                </span>
                            </div>
                            <Slider
                                min={32}
                                max={128}
                                step={8}
                                value={iconSize}
                                onValueChange={onIconSizeChange}
                                aria-label="Grid Icon Size"
                            />
                        </div>

                        <div className="flex items-center justify-between gap-4 pt-1 border-t border-m3-outline-variant/40">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-m3-on-surface">
                                    Show Hidden Files
                                </span>
                                <span className="text-xs text-m3-on-surface-variant">
                                    Display dotfiles and hidden directories
                                </span>
                            </div>
                            <Switch
                                checked={showHiddenFiles}
                                onCheckedChange={() => onToggleHiddenFiles()}
                                ariaLabel="Show Hidden Files"
                            />
                        </div>

                        <div className="flex items-center justify-between gap-4 pt-1 border-t border-m3-outline-variant/40">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-m3-on-surface">
                                    Filled File Icons
                                </span>
                                <span className="text-xs text-m3-on-surface-variant">
                                    Use solid Material Symbols for items
                                </span>
                            </div>
                            <Switch
                                checked={filledIcons}
                                onCheckedChange={() => onToggleFilledIcons()}
                                ariaLabel="Filled File Icons"
                            />
                        </div>
                    </section>

                    {/* Section 3: Custom Stylesheet */}
                    <section className="flex flex-col gap-3 rounded-m3-lg bg-m3-surface-container-high/60 p-4">
                        <div className="flex items-center gap-2 text-m3-primary text-xs font-semibold uppercase tracking-wider">
                            <Icon name="css" size={16} filled />
                            <span>Custom Stylesheet</span>
                        </div>
                        <p className="text-xs text-m3-on-surface-variant">
                            Optionally overlay custom CSS token overrides on top of M3 Expressive.
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="tonal"
                                size="sm"
                                icon={<Icon name="upload_file" size={18} />}
                                onClick={() => void importCustomCss()}
                            >
                                Import CSS...
                            </Button>
                            {customCssPath && (
                                <Button
                                    variant="text"
                                    size="sm"
                                    icon={<Icon name="delete_outline" size={18} />}
                                    onClick={clearCustomCss}
                                >
                                    Clear CSS
                                </Button>
                            )}
                        </div>
                        {customCssPath && (
                            <div
                                className="text-xs text-m3-primary truncate px-2.5 py-1.5 rounded-m3-sm bg-m3-primary-container/30"
                                title={customCssPath}
                            >
                                Loaded: {customCssPath}
                            </div>
                        )}
                    </section>
                </div>
            </ScrollArea>
        </Dialog>
    );
};
