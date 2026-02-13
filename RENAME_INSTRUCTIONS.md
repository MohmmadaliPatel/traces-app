# Application Rename: Notice Tracker → Traces Conso

## Summary of Changes

All references to "Notice Tracker" have been updated to "Traces Conso" across the application.

## Files Updated

### 1. **setup.iss** (Installer Configuration)

- ✅ Application name: "Notice tracker" → "Traces Conso"
- ✅ Publisher: "TaxTexk" → "TaxTeck" (fixed typo)
- ✅ Executable name: "notice-tracker.exe" → "traces-conso.exe"
- ✅ Output filename: "notice-tracker-setup" → "traces-conso-setup"

### 2. **src/core/layouts/Layout.tsx** (Application UI)

- ✅ Footer text: "Notice Tracker ©2023" → "Traces Conso ©2025"
- ✅ Page title: "not-track" → "Traces Conso"

### 3. **src/utils/getTrialExpirationDate.ts** (Registry Settings)

- ✅ Registry key: "\\Software\\Notice tracker" → "\\Software\\Traces Conso"

### 4. **make-dist.sh** (Build Script)

- ✅ Executable reference: "notice-tracker.exe" → "traces-conso.exe"

### 5. **README.md** (Documentation)

- ✅ Application name in title
- ✅ Folder structure reference

## Files/Folders That Need Manual Action

### Executable Files (Will be regenerated on build)

- `notice-tracker.exe` (root) → Needs to be rebuilt as `traces-conso.exe`
- `dist/notice-tracker.exe` → Will be replaced on next build
- `node-v22.5.1-x64.msi` → Keep as is (external dependency)
- `VC_redist.x64.exe` → Keep as is (external dependency)

### Output Folder (Old setup files - can be deleted)

- `Output/notice-tracker-setup-1.0.1.exe`
- `Output/notice-tracker-setup-bdo.exe`
- `Output/notice-tracker-setup-taxteck.exe`
- `Output/notice-tracker-setup.zip`

These will be replaced with new `traces-conso-setup.exe` files when you rebuild.

## Next Steps

### 1. Rebuild the Application

To generate the new executable with the updated name:

```bash
# Build the application
npm run build

# This should create traces-conso.exe instead of notice-tracker.exe
```

### 2. Create New Installer

Run the Inno Setup compiler on `setup.iss`:

```bash
# This will create traces-conso-setup.exe in the Output folder
iscc setup.iss
```

### 3. Clean Up Old Files (Optional)

After successfully building and testing:

```bash
# Remove old executable
rm notice-tracker.exe
rm dist/notice-tracker.exe

# Remove old installers
rm -rf Output/notice-tracker-*
```

### 4. Update Start Script (if needed)

If you have a `start.bat` or similar script that references `notice-tracker.exe`, update it to `traces-conso.exe`.

## Registry Note

⚠️ **Important**: Users who have already installed the application will have:

- Old registry entry: `HKCU\Software\Notice tracker`
- New registry entry: `HKCU\Software\Traces Conso`

The trial period will restart for existing users because the registry key has changed. If you want to preserve the trial period, you may need to:

1. Keep the old registry key name temporarily, OR
2. Add migration code to copy the `InstallDate` from the old key to the new key

## Testing Checklist

- [ ] Application builds successfully
- [ ] Executable is named `traces-conso.exe`
- [ ] Installer is named `traces-conso-setup.exe`
- [ ] Application title shows "Traces Conso" in browser tab
- [ ] Footer shows "Traces Conso ©2025 Created by TaxTeck"
- [ ] Desktop shortcut is named "Traces Conso"
- [ ] Start menu entry is "Traces Conso"
- [ ] Registry key is created at `HKCU\Software\Traces Conso`
- [ ] Application functions correctly after rename

## Verification Commands

```bash
# Check for any remaining "notice-tracker" references (case-insensitive)
grep -ri "notice-tracker" .

# Check for any remaining "Notice Tracker" references
grep -r "Notice Tracker" .

# Should find no results (except in this file and git history)
```

## Notes

- Package name in `package.json` remains as "not-track" (internal identifier)
- This is intentional and doesn't need to change
- The database name remains as configured in `.env` files
- No database migrations needed for this rename

---

**Last Updated**: 2025
**Performed By**: AI Assistant
