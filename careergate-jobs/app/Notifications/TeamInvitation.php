<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Invitation to the back office: English and Arabic in one email, link valid for 7 days. */
class TeamInvitation extends Notification
{
    public function __construct(public string $token) {}

    /** @return array<int, string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = url(route('password.reset', [
            'token' => $this->token,
            'email' => $notifiable->getEmailForPasswordReset(),
            'invite' => 1,
        ], false));
        $days = (int) (config('auth.passwords.invites.expire') / 1440);

        $mail = (new MailMessage)
            ->subject(__('mail.invite.subject', [], 'en').' / '.__('mail.invite.subject', [], 'ar'))
            ->greeting(__('mail.invite.greeting', ['name' => $notifiable->name], 'en'))
            ->line(__('mail.invite.intro', [], 'en'))
            ->action(__('mail.invite.action', [], 'en').' / '.__('mail.invite.action', [], 'ar'), $url)
            ->line(__('mail.invite.expires', ['days' => $days], 'en'))
            ->line(__('mail.invite.ignore', [], 'en'))
            ->line('---')
            ->line(__('mail.invite.greeting', ['name' => $notifiable->name], 'ar'))
            ->line(__('mail.invite.intro', [], 'ar'))
            ->line(__('mail.invite.expires', ['days' => $days], 'ar'))
            ->line(__('mail.invite.ignore', [], 'ar'));

        return $mail;
    }
}
