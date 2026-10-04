async function startPayment(productId) {
    const email = prompt(
        'Enter the email address for your receipt and secure product delivery:'
    );

    if (!email) return;

    const cleanEmail = email.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
        alert('Please enter a valid email address.');
        return;
    }

    const choice = prompt(
        'Choose payment currency: NGN or USD',
        'NGN'
    );

    if (!choice) return;

    const currency = choice.trim().toUpperCase();

    if (!['NGN', 'USD'].includes(currency)) {
        alert('Please enter NGN or USD.');
        return;
    }

    try {
        const response = await fetch('/api/initialize-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: cleanEmail,
                productId: productId,
                currency: currency
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || 'Unable to start payment.'
            );
        }

        if (!data.authorization_url) {
            throw new Error(
                'Paystack checkout URL was not returned.'
            );
        }

        console.log('Redirecting to Paystack:', data.authorization_url);

        window.location.href = data.authorization_url;

    } catch (error) {
        console.error('Payment initialization error:', error);

        alert(
            'We could not open the secure payment page. Please try again.'
        );
    }
}

window.startPayment = startPayment;