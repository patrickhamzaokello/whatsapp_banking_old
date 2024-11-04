import crypto from 'crypto';

export function generatePaymentLink(amount, currency, customerCode, orderId, payerName, transDetails, transDate, emailAddress, secureSecret) {
    // Additional parameters
    const gtp_SecureHashType = "SHA256";

    // Concatenate input data for hashing
    const hash_input_data = 
    `gtp_Amount=${amount}&` +
    `gtp_Currency=${currency}&` +
    `gtp_CustomerCode=${customerCode}&` +
    `gtp_OrderId=${orderId}&` +
    `gtp_PayerName=${payerName}&` +
    `gtp_TransDetails=${transDetails}`;

    function hashAllFields(hash_input, sec_val, secure_hash_secret) {
        // Remove trailing ampersand
        hash_input = hash_input.replace(/&$/, '');

        // Convert secure hash secret from hexadecimal to bytes
        const secret_bytes = Buffer.from(secure_hash_secret, 'hex');

        // Calculate HMAC-SHA256
        const hashed_data = crypto.createHmac('sha256', secret_bytes)
                                  .update(hash_input + sec_val)
                                  .digest('hex')
                                  .toUpperCase();

        return hashed_data;
    }

    // Build the URL
    const secure_hash = hashAllFields(hash_input_data, gtp_SecureHashType, secureSecret);
    const url = 
    `https://ibank.gtbank.co.ug/GTBANK/AFGTPAY/GTPAY/GTPay.aspx?` +
    `${hash_input_data}&` +
    `gtp_TransDate=${transDate}&` +
    `gtp_SecureHash=${secure_hash}&` +
    `gtp_SecureHashType=${gtp_SecureHashType}&` +
    `gtp_EmailAddress=${emailAddress}`;

    return url;
}
