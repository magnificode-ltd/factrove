-- Reset links used to store reset-password:<token> in verification.identifier.
-- New links store a hash of that identifier. Delete the plaintext rows so a
-- leftover token cannot be read back or redeemed. Email-verification rows
-- use a different identifier and are left in place. A second run deletes
-- nothing further.

DELETE FROM verification
WHERE identifier LIKE 'reset-password:%';
