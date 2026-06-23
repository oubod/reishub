# PDF Character Encoding Fix

## Problem
Generated PDF files had character encoding issues where:
- French characters (like é, è, à, ç) were appearing as garbled text with ampersands (`&R&è&'&p&o&n&s&è&`)
- Each character was being separated by `&` symbols
- Accented characters were being destroyed

## Root Cause
The previous fix used `.normalize('NFD')` which **decomposes** accented characters (e.g., `é` becomes `e` + combining accent mark). This caused:
1. French characters to be split into base character + accent
2. Accent marks were then incorrectly replaced or removed
3. jsPDF received malformed text with separated characters

## Solution Implemented (Fixed November 13, 2025)
Rewrote the text sanitization function to:

1. **Decode HTML entities** first (in case text contains entities)
2. **Preserve French accented characters** completely (é, è, à, ç, ê, etc.)
3. **Replace only truly problematic characters**:
   - Smart quotes → regular quotes
   - En/em dashes → regular hyphens
   - Ellipsis → three dots
   - Unicode spaces → regular spaces
   - Control characters → removed

4. **REMOVED** the NFD normalization and accent decomposition entirely

## Changes Made

### 1. Fixed `sanitizeTextForPdf()` Function (Line ~1791)
```javascript
const sanitizeTextForPdf = (text) => {
    if (!text) return '';
    
    // Create a temporary element to decode HTML entities
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    let decoded = textarea.value;
    
    // Replace only problematic characters that jsPDF can't handle
    // Keep French accented characters intact (é, è, à, ç, etc.)
    return decoded
        .replace(/'/g, "'")  // Replace smart quotes
        .replace(/'/g, "'")
        .replace(/"/g, '"')  // Replace smart double quotes
        .replace(/"/g, '"')
        .replace(/–/g, '-')  // Replace en dash
        .replace(/—/g, '-')  // Replace em dash
        .replace(/…/g, '...')  // Replace ellipsis
        .replace(/[\u2000-\u200F\u2028-\u202F]/g, ' ')  // Replace unicode spaces
        .replace(/[\u0080-\u009F]/g, '')  // Remove control characters
        .replace(/\u00A0/g, ' ');  // Replace non-breaking space
};
```

### 2. Updated All PDF Generation Functions

#### Exam PDF Generation (Lines ~1300-1500)
- Updated `drawPageHeader()` to sanitize header text
- Updated `addBodyText()` to sanitize body text
- Updated `addSectionTitle()` to sanitize section titles
- Updated `addQuestionHeader()` to sanitize question headers
- Updated `addSummaryCard()` to sanitize summary text

#### Single Lecture PDF Generation (Lines ~1640-1780)
- Updated `addHeader()` to sanitize header text
- Updated `addBodyText()` to sanitize body text

#### Multi-Lecture PDF Generation (Lines ~1824-2220)
- Updated `addHeader()` to sanitize header text
- Updated `addBodyText()` to sanitize body text
- Updated title page text (Objectif Résidanat, Étudiant, etc.)
- Updated date formatting text
- Updated page numbers and footers

## Impact
This fix ensures that:
- ✅ **French accented characters preserved**: é, è, à, ç, ê, ô, û, ï, etc. display correctly
- ✅ **No more garbled text**: Fixed the `&R&è&'&p&o&n&s&è&` character separation issue
- ✅ **HTML entities decoded**: Any HTML-encoded text is properly converted
- ✅ **Smart quotes handled**: Typography characters replaced with PDF-safe equivalents
- ✅ **Works for ALL PDF types**: Exam PDFs, single lecture PDFs, multi-lecture PDFs
- ✅ **Consistent rendering**: All French medical terminology displays correctly

## What Was Wrong Before
The previous approach tried to "fix" French accents by:
1. Decomposing `é` into `e` + accent mark (NFD normalization)
2. Replacing accent marks with ASCII characters (`, ', ^, etc.)
3. This destroyed French words: "Réponse" → "Re'ponse" → garbled

## What's Right Now
The new approach:
1. **Keeps French characters intact** - no decomposition
2. Only replaces characters that actually break jsPDF (smart quotes, em dashes, etc.)
3. Properly decodes any HTML entities if present

## Testing
To verify the fix works:
1. Generate a PDF for "Électrophysiologie cardiaque" or any lecture with French characters
2. Check that text like "Réponse", "répolarisation", "dépolarisation" displays correctly
3. Verify that words with accents (é, è, à, ê, etc.) are perfectly readable
4. Ensure no `&` symbols appear between characters

## Files Modified
- `js/app.js` - Fixed the `sanitizeTextForPdf()` function (line ~1791)
- `PDF_ENCODING_FIX.md` - Updated documentation

## Date
**Initial broken fix**: November 13, 2025 (early)  
**Proper fix applied**: November 13, 2025 (corrected)
