/**
 * Indian mobile numbers only (plan task 2.8). A mobile number in India has 10 digits and starts with 6, 7, 8
 * or 9; a number that is one digit repeated (9999999999) is not a real person. Anything else is refused
 * before a sign-in code is made, because bulk requests ("SMS pumping") are sent to numbers like those.
 *
 * Takes the 10 digits phone-auth has already cleaned out of what the person typed.
 */
export function isIndianMobile(phone: string): boolean {
  return /^[6-9][0-9]{9}$/.test(phone) && !/^(.)\1{9}$/.test(phone);
}

/**
 * Whether phone-auth takes this number at all. A number on the TEST_PHONES allowlist (set only in the function's
 * secrets, for development) is taken even when it is not a real Indian mobile, such as 1111111111: it never reaches the
 * SMS gateway, so it cannot be pumped. Every other number must pass isIndianMobile.
 */
export function acceptsPhone(phone: string, testPhones: ReadonlySet<string>): boolean {
  return testPhones.has(phone) || isIndianMobile(phone);
}
