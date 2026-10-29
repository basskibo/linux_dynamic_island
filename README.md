# Dynamic Island for GNOME

<img src="icon.png" width="96" alt="">

<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/39bb63b9-f8fb-444c-bd9d-0f3f877631af" />
<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/10144d60-060b-4ad1-964d-82738655068a" />
<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/9b18daea-04c7-4418-a638-b9b4c3043667" />

<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/8ea98f0d-ac8b-4940-aafc-eaeee3c50711" />


iOS-style live island that shows what's playing (Spotify, YouTube in browsers, any MPRIS player).
Hover to expand with controls, click to open the player. Position is configurable in the extension settings: floating at a screen edge, or inside the top bar
(after Activities, left/right of the clock, or before the system menu).

Supports GNOME Shell 46–48.

## Install on another computer

```bash
gnome-extensions install --force dynamic-island@bjagetic.shell-extension.zip
```

Log out and back in (required on Wayland), then:

```bash
gnome-extensions enable dynamic-island@bjagetic
```

Settings: open the Extensions app → Dynamic Island → ⚙, or run `gnome-extensions prefs dynamic-island@bjagetic`.

## Build the zip after changes

```bash
./pack.sh
```
