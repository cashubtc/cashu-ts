import { AmountPreference, Preferences } from '../model/types/index';

export const deprecatedAmountPreferences = function (pref: Array<AmountPreference>): Preferences {
    console.warn("[DEPRECATION] Use `Preferences` instead of `Array<AmountPreference>`");
    return { sendPreference: pref };
}

export const isAmountPreference = function (obj: any): obj is AmountPreference {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'amount' in obj &&
        'count' in obj &&
        typeof obj.amount === 'number' &&
        typeof obj.count === 'number'
    );
}

export const isAmountPreferenceArray = function (preference?: any): preference is Array<AmountPreference> {
    return Array.isArray(preference) && preference.every((item) => isAmountPreference(item));
}