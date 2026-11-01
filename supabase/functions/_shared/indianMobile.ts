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
